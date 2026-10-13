// [P4-09] Cancels ECPay orders that were never paid, releasing their stock reservations.
// Deadlines: lib/ecpay/unpaid.ts, anchored on the CURRENT (newest) trade, so a re-pay restarts
// the clock (review payments-1 / cross-1). Each due order is decided twice: on the page read
// (cheap selection; stale is fine) and again under the collection lock on a fresh read
// (lib/ecpay/collection-lock.ts), which ReturnURL, the reconcile jobs, re-pay and PaymentInfoURL
// also hold, so no payment can be recorded between ECPay's "unpaid" and the cancel (review
// payments-3). Under the lock, ECPay is asked about EVERY trade of the order, newest first
// (strict query; re-pay keeps old trades and any of them may have been paid):
//  - paid -> recorded through recordVerifiedPaymentHeld (a lost notice), NOT canceled. The
//    Held variant because this job already holds the lock (locks are not re-entrant);
//  - ECPay unreachable / unsigned -> not canceled this run (fail closed);
//  - all unpaid -> cancelOrderWorkflow (Medusa releases reservations, cancels the payment
//    collection) + metadata ecpay_auto_canceled {at, reason, merchant_trade_no}.
// A collection that is busy (lock not free within 5 s) is kept and retried next run.
// Known limit (Medusa 2.21.2): canceling does not give back promotion usage (research
// docs/research/p4-p5-2026-10-13.md §3). A paid order is never touched (captured payments
// are excluded). At most 20 ECPay queries per run, 2 s apart; a 403 stops the run.
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { withCollectionLock } from "../lib/ecpay/collection-lock"
import { ECPAY_PROVIDER_ID, ecpayOptionsFromEnv } from "../lib/ecpay/config"
import { recordVerifiedPaymentHeld } from "../lib/ecpay/record-payment"
import { queryTrade } from "../lib/ecpay/trade-query"
import { anchorOf, cancelAfter, creditCancelMinutes, ecpayTradesNewestFirst } from "../lib/ecpay/unpaid"
import { markOrderMetadataWorkflow } from "../workflows/ecpay/mark-order-metadata"

const PAGE = 200
const MAX_QUERIES_PER_RUN = 20
const LOCK_WAIT_SECONDS = 5
const UNPAID_COLLECTION = ["awaiting", "not_paid"]
const FIELDS = [
  "id", "created_at", "status",
  "payment_collections.id", "payment_collections.status", "payment_collections.payments.captured_at",
  "payment_collections.payment_sessions.id", "payment_collections.payment_sessions.provider_id",
  "payment_collections.payment_sessions.created_at", "payment_collections.payment_sessions.data",
]

type SessionRow = { id: string; provider_id: string; created_at: string | Date; data?: Record<string, unknown> | null }
type OrderRow = {
  id: string
  created_at: string | Date
  status: string
  payment_collections?: {
    id: string
    status: string
    payments?: { captured_at?: unknown }[] | null
    payment_sessions?: SessionRow[] | null
  }[] | null
}
type Trade = SessionRow & { payment_collection_id: string }

// The order's ECPay trades, newest first, when it is due for cancellation; null when not.
export function dueTrades(o: OrderRow | undefined, now: Date, creditMinutes: number): Trade[] | null {
  const pcs = o?.payment_collections ?? []
  if (!o || o.status !== "pending" || !pcs.length || !pcs.every((pc) => UNPAID_COLLECTION.includes(pc.status))) return null
  if (pcs.some((pc) => (pc.payments ?? []).some((p) => !!p?.captured_at))) return null
  const trades = ecpayTradesNewestFirst(
    pcs.flatMap((pc) => (pc.payment_sessions ?? []).map((s) => ({ ...s, payment_collection_id: pc.id }))),
    ECPAY_PROVIDER_ID
  )
  const current = trades[0]
  if (!current || now < cancelAfter(current.data ?? {}, anchorOf(new Date(o.created_at), current), creditMinutes)) return null
  return trades
}

export async function cancelUnpaidOrders(container: MedusaContainer, opts: { now?: Date; gapMs?: number } = {}) {
  const now = opts.now ?? new Date()
  const gapMs = opts.gapMs ?? 2000
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const options = ecpayOptionsFromEnv()
  const creditMinutes = creditCancelMinutes()
  const outcomes: Record<string, string> = {}
  let queries = 0
  let stop = false

  // Runs with the order's collection lock held.
  const decide = async (orderId: string): Promise<string> => {
    const { data } = await query.graph({ entity: "order", fields: FIELDS, filters: { id: orderId } })
    const trades = dueTrades(data[0] as OrderRow | undefined, now, creditMinutes)
    if (!trades) {
      return "kept:changed" // paid, canceled or re-paid since the page was read
    }
    let lastStatus = ""
    for (const s of trades) {
      const d = s.data ?? {}
      const merchantTradeNo = String(d.merchant_trade_no ?? "")
      const tag = `ECPay unpaid-cancel ${merchantTradeNo}`
      if (queries >= MAX_QUERIES_PER_RUN) {
        stop = true
        logger.warn(`${tag}: query budget used up (${MAX_QUERIES_PER_RUN}); order ${orderId} waits for the next run`)
        return "kept:query_budget"
      }
      if (queries > 0 && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs))
      queries++
      const r = await queryTrade(options, merchantTradeNo)
      if (r.kind === "error") {
        logger.warn(`${tag}: not canceled, ECPay did not answer (${r.message})`)
        if (r.rateLimited) stop = true
        return "kept:ecpay_unreachable"
      }
      if (r.kind === "paid") {
        if (r.info.tradeAmt !== Number(d.amount)) {
          logger.error(`${tag}: [ECPAY-ALERT] paid NT$${r.info.tradeAmt} but the session expects NT$${String(d.amount)}; not canceled`)
          return "kept:amount_mismatch"
        }
        try {
          return `paid:${await recordVerifiedPaymentHeld(
            container,
            {
              session: { id: s.id, payment_collection_id: s.payment_collection_id },
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
          logger.error(`${tag}: [ECPAY-ALERT] paid at ECPay but recording failed: ${(e as Error).message}`)
          return "kept:record_failed"
        }
      }
      lastStatus ||= r.info.tradeStatus
    }
    const merchantTradeNo = String(trades[0].data?.merchant_trade_no ?? "")
    try {
      await cancelOrderWorkflow(container).run({ input: { order_id: orderId, canceled_by: "drn-unpaid-cancel" } })
      await markOrderMetadataWorkflow(container).run({
        input: {
          order_id: orderId,
          key: "ecpay_auto_canceled",
          value: { at: now.toISOString(), reason: `unpaid (TradeStatus ${lastStatus})`, merchant_trade_no: merchantTradeNo },
        },
      })
    } catch (e) {
      logger.error(`ECPay unpaid-cancel ${merchantTradeNo}: [ECPAY-ALERT] could not cancel unpaid order ${orderId}: ${(e as Error).message}`)
      return "kept:cancel_failed"
    }
    logger.info(`ECPay unpaid-cancel ${merchantTradeNo}: order ${orderId} canceled, never paid (${trades.length} trade(s), TradeStatus ${lastStatus})`)
    return "canceled"
  }

  for (let skip = 0; !stop; skip += PAGE) {
    const { data } = await query.graph({
      entity: "order",
      fields: FIELDS,
      // Every cancel deadline is at least order.created_at + creditMinutes (the anchor is never
      // before the order), so this pre-filter can only delay a cancel, never bring one forward.
      filters: { status: "pending", is_draft_order: false, created_at: { $lt: new Date(now.getTime() - creditMinutes * 60 * 1000) } },
      pagination: { skip, take: PAGE, order: { created_at: "ASC" } },
    })
    for (const o of data as OrderRow[]) {
      if (stop) break
      if (!dueTrades(o, now, creditMinutes)) continue
      const pcIds = (o.payment_collections ?? []).map((pc) => pc.id)
      try {
        outcomes[o.id] = await withCollectionLock(container, pcIds, () => decide(o.id), LOCK_WAIT_SECONDS)
      } catch (e) {
        const busy = (e as MedusaError).type === MedusaError.Types.CONFLICT
        outcomes[o.id] = busy ? "kept:busy" : "kept:cancel_failed"
        logger.warn(`ECPay unpaid-cancel: order ${o.id} kept (${busy ? "payment collection busy, retried next run" : (e as Error).message})`)
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
