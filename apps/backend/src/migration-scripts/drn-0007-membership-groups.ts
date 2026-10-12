// [P5-03] Customer groups for the paid membership tiers (docs/strategy/membership.md §6.4,
// §10). The entry tier ("member") has no group. Names come from the tier config, so the
// engine and promotions (P5-04, rule customer.groups.id in [...]) agree. Idempotent.
import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createCustomerGroupsWorkflow } from "@medusajs/medusa/core-flows"
import { loadTierConfig } from "../lib/membership/config"

export default async function drnMembershipGroups({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const c = loadTierConfig()
  const wanted = Object.entries(c.customer_groups)
  const existing = await container.resolve(Modules.CUSTOMER).listCustomerGroups({ name: { $in: wanted.map(([, name]) => name) } }, { select: ["name"] })
  const have = new Set(existing.map((g) => g.name))
  const missing = wanted.filter(([, name]) => !have.has(name))
  if (missing.length) {
    await createCustomerGroupsWorkflow(container).run({
      input: {
        customersData: missing.map(([code, name]) => ({
          name,
          metadata: { drn_tier: code, tier_name: c.tiers.find((t) => t.code === code)!.name },
        })),
      },
    })
  }
  logger.info(`[drn-0007] membership tier groups ready: ${wanted.map(([, n]) => n).join(", ")}`)
}
