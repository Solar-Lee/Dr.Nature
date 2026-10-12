// [P4-09] Cancels ECPay orders that were never paid, releasing their stock reservations.
// Deadlines: lib/ecpay/unpaid.ts. Before each cancel ECPay is asked once (strict query):
//  - paid -> recorded through recordVerifiedPayment (a lost notice), NOT canceled;
//  - ECPay unreachable / unsigned -> not canceled this run (fail closed);
//  - unpaid -> cancelOrderWorkflow (Medusa releases reservations, cancels the payment
//    collection) + metadata ecpay_auto_canceled {at, reason, merchant_trade_no}.
// Known limit (Medusa 2.21.2): canceling does not give back promotion usage (research
// docs/research/p4-p5-2026-10-13.md §3). A paid order is never touched (captured payments
// are excluded). 20 orders per run, queries 2 s apart; a 403 stops the run.
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { ECPAY_PROVIDER_ID, ecpayOptionsFromEnv } from "../lib/ecpay/config"
import { recordVerifiedPayment } from "../lib/ecpay/record-payment"
import { queryTrade } from "../lib/ecpay/trade-query"
import { cancelAfter, creditCancelMinutes } from "../lib/ecpay/unpaid"
import { markOrderMetadataWorkflow } from "../workflows/ecpay/mark-order-metadata"

const PAGE = 200
const MAX_PER_RUN = 20
const UNPAID_COLLECTION = ["awaiting", "not_paid"]

type OrderRow = {
  id: string
  created_at: string | Date
  status: string
  payment_collections?: {
    id: string
    status: string
    payments?: { captured_at?: unknown }[] | null
    payment_sessions?: { id: string; provider_id: string; created_at: string | Date; data?: Record<string, unknown> | null }[] | null
  }[] | null
}

export async function cancelUnpaidOrders(container: MedusaContainer, opts: { now?: Date; gapMs?: number } = {}) {
  const now = opts.now ?? new Date()
  const gapMs = opts.gapMs ?? 2000
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const options = ecpayOptionsFromEnv()
  const creditMinutes = creditCancelMinutes()
  const outcomes: Record<string, string> = {}
  let handled = 0

  for (let skip = 0; handled < MAX_PER_RUN; skip += PAGE) {
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id", "created_at", "status",
        "payment_collections.id", "payment_collections.status", "payment_collections.payments.captured_at",
        "payment_collections.payment_sessions.id", "payment_collections.payment_sessions.provider_id",
        "payment_collections.payment_sessions.created_at", "payment_collections.payment_sessions.data",
      ],
      filters: { status: "pending", is_draft_order: false, created_at: { $lt: new Date(now.getTime() - creditMinutes * 60 * 1000) } },
      pagination: { skip, take: PAGE, order: { created_at: "ASC" } },
    })
    for (const o of data as OrderRow[]) {
      if (handled >= MAX_PER_RUN) break
      const pcs = o.payment_collections ?? []
      if (!pcs.length || !pcs.every((pc) => UNPAID_COLLECTION.includes(pc.status))) continue
      if (pcs.some((pc) => (pc.payments ?? []).some((p) => !!p.captured_at))) continue
      const sessions = pcs.flatMap((pc) => (pc.payment_sessions ?? []).map((s) => ({ ...s, payment_collection_id: pc.id })))
      const ecpay = sessions
        .filter((s) => s.provider_id === ECPAY_PROVIDER_ID)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      if (!ecpay) continue
      const d = ecpay.data ?? {}
      if (now < cancelAfter(d, new Date(o.created_at), creditMinutes)) continue

      if (handled > 0 && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs))
      handled++
      const merchantTradeNo = String(d.merchant_trade_no ?? "")
      const tag = `ECPay unpaid-cancel ${merchantTradeNo}`
      const r = await queryTrade(options, merchantTradeNo)
      if (r.kind === "error") {
        outcomes[o.id] = "kept:ecpay_unreachable"
        logger.warn(`${tag}: not canceled, ECPay did not answer (${r.message})`)
        if (r.rateLimited) break
        continue
      }
      if (r.kind === "paid") {
        if (r.info.tradeAmt !== Number(d.amount)) {
          outcomes[o.id] = "kept:amount_mismatch"
          logger.error(`${tag}: [ECPAY-ALERT] paid NT$${r.info.tradeAmt} but the session expects NT$${String(d.amount)}; not canceled`)
          continue
        }
        try {
          outcomes[o.id] = `paid:${await recordVerifiedPayment(
            container,
            {
              session: { id: ecpay.id, payment_collection_id: ecpay.payment_collection_id },
              proofKey: "ecpay_trade_info",
              proof: r.info.raw,
              merchantTradeNo,
              tradeNo: r.info.tradeNo,
              amount: r.info.tradeAmt,
              paymentDate: r.info.raw.PaymentDate ?? "",
            },
            tag
          )}`
        } catch (e) {
          outcomes[o.id] = "kept:record_failed"
          logger.error(`${tag}: [ECPAY-ALERT] paid at ECPay but recording failed: ${(e as Error).message}`)
        }
        continue
      }
      try {
        await cancelOrderWorkflow(container).run({ input: { order_id: o.id, canceled_by: "drn-unpaid-cancel" } })
        await markOrderMetadataWorkflow(container).run({
          input: {
            order_id: o.id,
            key: "ecpay_auto_canceled",
            value: { at: now.toISOString(), reason: `unpaid (TradeStatus ${r.info.tradeStatus})`, merchant_trade_no: merchantTradeNo },
          },
        })
        outcomes[o.id] = "canceled"
        logger.info(`${tag}: order ${o.id} canceled, never paid (TradeStatus ${r.info.tradeStatus})`)
      } catch (e) {
        outcomes[o.id] = "kept:cancel_failed"
        logger.error(`${tag}: [ECPAY-ALERT] could not cancel unpaid order ${o.id}: ${(e as Error).message}`)
      }
    }
    if (data.length < PAGE) break
  }
  return outcomes
}

export default async function ecpayUnpaidCancelJob(container: MedusaContainer) {
  // Tests call cancelUnpaidOrders directly; the wall-clock cron must not interleave.
  if (!process.env.ECPAY_ENV || process.env.NODE_ENV === "test") {
    return
  }
  await cancelUnpaidOrders(container)
}

export const config = {
  name: "drn-ecpay-unpaid-cancel",
  schedule: "*/15 * * * *",
}
