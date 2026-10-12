// [P5-03] Tier engine: recompute one member's tier and move them between tier customer groups
// (membership.md §4, §10.1). Called by the refund/cancel subscriber and the daily job.
//  - Members are customers with an account (has_account); guest checkouts are not members.
//  - The customer-group membership IS the tier (what promotions read, P5-04); the entry tier
//    has no group. A member in several tier groups is put back into exactly one.
//  - customer.metadata.drn_membership: tier, confirmed / pending spend, evaluated_at,
//    config_version; drn_membership_log: the last 50 tier changes with their reason.
//  - Idempotent: running it twice changes nothing the second time.
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN, MedusaError, Modules } from "@medusajs/framework/utils"
import { linkCustomerGroupsToCustomerWorkflow, updateCustomersWorkflow } from "@medusajs/medusa/core-flows"
import { engineBlockedReason, loadTierConfig, type TierConfig } from "./config"
import { decideTier, spendOf, type Reason, type SpendOrder } from "./rules"

const LOG_LIMIT = 50
const num = (v: unknown) => (v === null || v === undefined ? 0 : MathBN.convert(v as never).toNumber())

export type TierResult = {
  customer_id: string
  from: string
  to: string
  change: "up" | "down" | "none" | "held" | "skipped"
  confirmed: number
  pending: number
}

type OrderRow = {
  id: string
  status: string
  sales_channel_id: string | null
  summary?: { paid_total?: unknown; refunded_total?: unknown } | null
  payment_collections?: { payments?: { captured_at?: string | Date | null }[] | null }[] | null
  fulfillments?: { delivered_at?: string | Date | null; canceled_at?: string | Date | null }[] | null
}

export async function tierGroupIds(container: MedusaContainer, c: TierConfig): Promise<Map<string, string>> {
  const names = Object.values(c.customer_groups)
  const groups = await container.resolve(Modules.CUSTOMER).listCustomerGroups({ name: { $in: names } }, { select: ["id", "name"] })
  const byName = new Map(groups.map((g) => [g.name, g.id]))
  const out = new Map<string, string>()
  for (const [code, name] of Object.entries(c.customer_groups)) {
    const id = byName.get(name)
    if (!id) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `[MEMBERSHIP] customer group "${name}" is missing (migration drn-0007)`)
    }
    out.set(code, id)
  }
  return out
}

async function channelIds(container: MedusaContainer, c: TierConfig): Promise<Set<string>> {
  const channels = await container.resolve(Modules.SALES_CHANNEL).listSalesChannels({ name: c.spend.sales_channels }, { select: ["id"] })
  return new Set(channels.map((s) => s.id))
}

export function toSpendOrder(o: OrderRow): SpendOrder {
  const captured = (o.payment_collections ?? [])
    .flatMap((pc) => pc.payments ?? [])
    .map((p) => (p.captured_at ? new Date(p.captured_at) : null))
    .filter((d): d is Date => d !== null)
  return {
    id: o.id,
    status: o.status,
    sales_channel_id: o.sales_channel_id,
    captured_at: captured.length ? new Date(Math.min(...captured.map((d) => d.getTime()))) : null,
    paid_total: num(o.summary?.paid_total),
    refunded_total: num(o.summary?.refunded_total),
    deliveries: (o.fulfillments ?? []).filter((f) => !f.canceled_at).map((f) => (f.delivered_at ? new Date(f.delivered_at) : null)),
  }
}

type RecomputeOpts = { now?: Date; config?: TierConfig; groups?: Map<string, string>; channels?: Set<string> }

// One recompute per member at a time (refund event vs daily job): the group link table has no
// unique constraint, so two concurrent "add" calls would insert the member twice.
export async function recomputeCustomerTier(
  container: MedusaContainer,
  customerId: string,
  reason: Reason,
  opts: RecomputeOpts = {}
): Promise<TierResult> {
  return container
    .resolve(Modules.LOCKING)
    .execute(`drn-membership:${customerId}`, () => recomputeUnlocked(container, customerId, reason, opts), { timeout: 30 })
}

async function recomputeUnlocked(container: MedusaContainer, customerId: string, reason: Reason, opts: RecomputeOpts): Promise<TierResult> {
  const now = opts.now ?? new Date()
  const c = loadTierConfig(opts.config)
  const blocked = engineBlockedReason(c)
  if (blocked) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `[MEMBERSHIP] engine disabled: ${blocked}`)
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const groups = opts.groups ?? (await tierGroupIds(container, c))
  const channels = opts.channels ?? (await channelIds(container, c))

  const { data: customers } = await query.graph({
    entity: "customer",
    fields: ["id", "has_account", "metadata", "groups.id"],
    filters: { id: customerId },
  })
  const customer = customers[0] as
    | { id: string; has_account: boolean; metadata?: Record<string, unknown> | null; groups?: { id: string }[] | null }
    | undefined
  if (!customer?.has_account) {
    return { customer_id: customerId, from: c.tiers[0].code, to: c.tiers[0].code, change: "skipped", confirmed: 0, pending: 0 }
  }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id", "status", "sales_channel_id", "summary.*",
      "payment_collections.payments.captured_at",
      "fulfillments.delivered_at", "fulfillments.canceled_at",
    ],
    filters: { customer_id: customerId, created_at: { $gte: new Date(now.getTime() - (c.spend.rolling_window_days + 60) * 24 * 3600 * 1000) } },
  })
  const { confirmed, pending } = spendOf((orders as OrderRow[]).map(toSpendOrder), c, channels, now)

  // Current tier = the highest tier group the member is in (entry tier when none).
  const memberOf = new Set((customer.groups ?? []).map((g) => g.id))
  const current = [...c.tiers].reverse().find((t) => groups.has(t.code) && memberOf.has(groups.get(t.code)!))?.code ?? c.tiers[0].code
  const decision = decideTier(c, current, confirmed, reason, now)

  const want = groups.get(decision.code)
  const add = want && !memberOf.has(want) ? [want] : []
  const remove = [...groups.values()].filter((id) => id !== want && memberOf.has(id))
  if (add.length || remove.length) {
    await linkCustomerGroupsToCustomerWorkflow(container).run({ input: { id: customerId, add, remove } })
  }

  const tierName = c.tiers.find((t) => t.code === decision.code)!.name
  const prevLog = Array.isArray(customer.metadata?.drn_membership_log) ? (customer.metadata!.drn_membership_log as unknown[]) : []
  const changed = decision.code !== current
  await updateCustomersWorkflow(container).run({
    input: {
      selector: { id: customerId },
      update: {
        metadata: {
          drn_membership: {
            tier: decision.code,
            tier_name: tierName,
            confirmed_spend_twd: confirmed,
            pending_spend_twd: pending,
            held_until_review: decision.change === "held",
            evaluated_at: now.toISOString(),
            config_version: c.config_version,
          },
          ...(changed
            ? {
                drn_membership_log: [
                  ...prevLog,
                  { at: now.toISOString(), from: current, to: decision.code, reason, confirmed_spend_twd: confirmed, config_version: c.config_version },
                ].slice(-LOG_LIMIT),
              }
            : {}),
        },
      },
    },
  })
  return { customer_id: customerId, from: current, to: decision.code, change: decision.change, confirmed, pending }
}

// Daily evaluation of every member (has_account), 200 per page.
export async function evaluateAllMembers(container: MedusaContainer, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date()
  const c = loadTierConfig()
  const groups = await tierGroupIds(container, c)
  const channels = await channelIds(container, c)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const customerModule = container.resolve(Modules.CUSTOMER)
  const results: TierResult[] = []
  for (let skip = 0; ; skip += 200) {
    const page = await customerModule.listCustomers({ has_account: true }, { select: ["id"], skip, take: 200, order: { created_at: "ASC" } })
    for (const { id } of page) {
      try {
        results.push(await recomputeCustomerTier(container, id, "daily", { now, config: c, groups, channels }))
      } catch (e) {
        logger.error(`[MEMBERSHIP-ALERT] daily evaluation failed for customer ${id}: ${(e as Error).message}`)
      }
    }
    if (page.length < 200) break
  }
  const changed = results.filter((r) => r.change === "up" || r.change === "down")
  logger.info(`[membership] evaluated ${results.length} members, ${changed.length} tier changes`)
  return results
}
