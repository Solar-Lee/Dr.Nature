// [P4-06] Every 15 minutes: issue e-invoices that the subscriber could not (ECPay down,
// worker restarted mid-way, ...). Looks at orders placed in the last 30 days that are paid
// and have no issued/voided invoice; the workflow itself re-checks everything under a lock.
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ecpayInvoiceConfigured } from "../lib/ecpay/config"
import type { InvoiceRecord } from "../lib/ecpay/invoice"
import { ECPAY_INVOICE_KEY } from "../workflows/ecpay/ecpay-invoice-steps"
import { issueEcpayInvoiceWorkflow } from "../workflows/ecpay/issue-ecpay-invoice"

const LOOKBACK_DAYS = 30
const MAX_PER_RUN = 25
const SCAN_LIMIT = 500
// Stop retrying an order after this many failed attempts (staff are alerted long before).
const MAX_ATTEMPTS = 50

export async function retryPendingInvoices(container: MedusaContainer, now = new Date()) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "status", "metadata", "payment_collections.payments.captured_at"],
    filters: { created_at: { $gte: since } },
    pagination: { take: SCAN_LIMIT, order: { created_at: "DESC" } },
  })
  if (data.length >= SCAN_LIMIT) {
    logger.warn(`e-invoice retry scanned only the newest ${SCAN_LIMIT} orders of the last ${LOOKBACK_DAYS} days`)
  }
  const pending = (data as { id: string; status: string; metadata?: Record<string, unknown> | null; payment_collections?: { payments?: { captured_at?: unknown }[] | null }[] | null }[])
    .filter((o) => o.status !== "canceled")
    .filter((o) => (o.payment_collections ?? []).some((pc) => (pc.payments ?? []).some((p) => !!p.captured_at)))
    .filter((o) => {
      const r = o.metadata?.[ECPAY_INVOICE_KEY] as InvoiceRecord | undefined
      return !r || (r.status === "failed" && (r.attempts ?? 0) < MAX_ATTEMPTS)
    })
    .slice(0, MAX_PER_RUN)
  const outcomes: Record<string, string> = {}
  for (const o of pending) {
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
  if (!ecpayInvoiceConfigured()) {
    return
  }
  await retryPendingInvoices(container)
}

export const config = {
  name: "drn-ecpay-invoice-retry",
  schedule: "*/15 * * * *",
}
