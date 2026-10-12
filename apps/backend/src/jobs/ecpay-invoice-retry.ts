// [P4-06] Every 15 minutes: finish e-invoicing the subscribers could not (ECPay down, a lost
// event — on the Redis event bus an old worker can take it, see docs/research/
// ecpay-invoice-p4-06.md §5 — or a worker restart). Looks at every order placed in the last
// 30 days that is paid and has no issued/voided invoice, or a pending re-issue, or is
// canceled with an unknown outcome (reconcile only). The workflow re-checks everything
// under the per-order lock.
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ecpayInvoiceConfigured } from "../lib/ecpay/config"
import type { InvoiceRecord } from "../lib/ecpay/invoice"
import { ECPAY_INVOICE_KEY } from "../workflows/ecpay/ecpay-invoice-steps"
import { issueEcpayInvoiceWorkflow } from "../workflows/ecpay/issue-ecpay-invoice"

const LOOKBACK_DAYS = 30
const PAGE = 200
const MAX_PER_RUN = 25
// Stop retrying an order after this many failed attempts (staff are alerted long before).
export const MAX_ATTEMPTS = 50

type OrderRow = {
  id: string
  status: string
  metadata?: Record<string, unknown> | null
  payment_collections?: { payments?: { captured_at?: unknown }[] | null }[] | null
}

export function needsInvoiceWork(o: OrderRow): boolean {
  const paid = (o.payment_collections ?? []).some((pc) => (pc.payments ?? []).some((p) => !!p.captured_at))
  if (!paid) return false
  const r = o.metadata?.[ECPAY_INVOICE_KEY] as InvoiceRecord | undefined
  if (!r) return true // also canceled: reconcile in case ECPay issued it
  if (r.status === "pending") return o.status !== "canceled"
  return r.status === "failed" && (r.attempts ?? 0) < MAX_ATTEMPTS
}

export async function retryPendingInvoices(container: MedusaContainer, now = new Date()) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const pending: OrderRow[] = []
  for (let skip = 0; ; skip += PAGE) {
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "status", "metadata", "payment_collections.payments.captured_at"],
      filters: { created_at: { $gte: since } },
      pagination: { skip, take: PAGE, order: { created_at: "ASC" } },
    })
    pending.push(...(data as OrderRow[]).filter(needsInvoiceWork))
    if (data.length < PAGE) break
  }
  if (pending.length > MAX_PER_RUN) {
    logger.warn(`e-invoice retry: ${pending.length} orders need work; doing the oldest ${MAX_PER_RUN} this run`)
  }
  const outcomes: Record<string, string> = {}
  for (const o of pending.slice(0, MAX_PER_RUN)) {
    try {
      const { result } = await issueEcpayInvoiceWorkflow(container).run({ input: { order_id: o.id } })
      outcomes[o.id] = result.outcome
    } catch (e) {
      outcomes[o.id] = "error"
      logger.error(`e-invoice retry for order ${o.id} errored: ${(e as Error).message}`)
    }
  }
  if (pending.length) {
    logger.info(`e-invoice retry: ${JSON.stringify(outcomes)}`)
  }
  return outcomes
}

export default async function ecpayInvoiceRetryJob(container: MedusaContainer) {
  // Tests call retryPendingInvoices directly; the wall-clock cron must not interleave.
  if (!ecpayInvoiceConfigured() || process.env.NODE_ENV === "test") {
    return
  }
  await retryPendingInvoices(container)
}

export const config = {
  name: "drn-ecpay-invoice-retry",
  schedule: "*/15 * * * *",
}
