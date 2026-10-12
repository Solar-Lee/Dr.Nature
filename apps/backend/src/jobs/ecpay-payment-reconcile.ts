// [P4-10] Recovers credit-card payments whose ReturnURL notice never arrived.
// ECPay's guidance (developers.ecpay.com.tw/2890/, /2887/): query a credit trade with
// QueryTradeInfo when no notice has arrived 40 minutes after creation; do NOT poll offline
// methods (ATM / CVS code / barcode) — those are covered by the daily TradeNoAio file (P4-07).
// No published rate limit, only "too fast -> HTTP 403, wait 30 minutes", so:
//  - each credit session is asked at most 3 times: >= 40 min, >= 2 h, >= 24 h after it was
//    created, never after 48 h (counted per process: a restart may ask once more);
//  - at most 15 queries per run, 2 s apart; a 403 stops the run and pauses all queries.
// A paid, signed answer bound to the session is handed to recordVerifiedPayment — the same
// path as the ReturnURL route (canceled-order guard, capture, cart -> order).
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ECPAY_PROVIDER_ID, ecpayOptionsFromEnv } from "../lib/ecpay/config"
import { recordVerifiedPayment } from "../lib/ecpay/record-payment"
import { queryTrade } from "../lib/ecpay/trade-query"

const MIN = 60 * 1000
export const QUERY_AT_MINUTES = [40, 120, 24 * 60]
const MAX_AGE_MS = 48 * 60 * MIN
const MAX_QUERIES_PER_RUN = 15

const asked = new Map<string, number>()

export function resetReconcileMemory() {
  asked.clear()
}

type SessionRow = {
  id: string
  status: string
  created_at: string | Date
  payment_collection_id: string
  data?: Record<string, unknown> | null
}

// How many query points this session's age has passed (0 = not due yet).
export function dueAttempts(ageMs: number): number {
  return QUERY_AT_MINUTES.filter((m) => ageMs >= m * MIN).length
}

export async function reconcileEcpayPayments(container: MedusaContainer, opts: { now?: Date; gapMs?: number } = {}) {
  const now = opts.now ?? new Date()
  const gapMs = opts.gapMs ?? 2000
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const options = ecpayOptionsFromEnv()

  const { data } = await query.graph({
    entity: "payment_session",
    fields: ["id", "status", "created_at", "payment_collection_id", "data"],
    filters: { provider_id: ECPAY_PROVIDER_ID, created_at: { $gte: new Date(now.getTime() - MAX_AGE_MS) } },
    pagination: { take: 500, order: { created_at: "ASC" } },
  })
  const outcomes: Record<string, string> = {}
  let queries = 0
  for (const s of data as SessionRow[]) {
    const d = s.data ?? {}
    if (["authorized", "captured", "canceled"].includes(s.status)) continue
    if (d.choose_payment !== "Credit") continue // offline: notices + daily file (P4-07)
    if (d.ecpay_notice || d.ecpay_trade_info) continue // proof already attached
    const due = dueAttempts(now.getTime() - new Date(s.created_at).getTime())
    if (due === 0 || (asked.get(s.id) ?? 0) >= due) continue
    if (queries >= MAX_QUERIES_PER_RUN) {
      logger.warn(`ECPay reconcile: query budget used up (${MAX_QUERIES_PER_RUN}); the rest waits for the next run`)
      break
    }
    if (queries > 0 && gapMs > 0) {
      await new Promise((r) => setTimeout(r, gapMs))
    }
    queries++
    asked.set(s.id, due)
    const merchantTradeNo = String(d.merchant_trade_no ?? "")
    const tag = `ECPay reconcile ${merchantTradeNo}`
    const r = await queryTrade(options, merchantTradeNo)
    if (r.kind === "error") {
      outcomes[s.id] = "error"
      logger.warn(`${tag}: ${r.message}`)
      if (r.rateLimited) {
        logger.error(`[ECPAY-ALERT] ECPay QueryTradeInfo rate limit hit; reconciliation paused 30 minutes`)
        break
      }
      asked.set(s.id, due - 1) // transient: ask this point again next run
      continue
    }
    if (r.kind === "unpaid") {
      outcomes[s.id] = `unpaid:${r.info.tradeStatus}`
      continue
    }
    if (r.info.tradeAmt !== Number(d.amount)) {
      outcomes[s.id] = "amount_mismatch"
      logger.error(`${tag}: [ECPAY-ALERT] amount mismatch (paid ${r.info.tradeAmt}, expected ${String(d.amount)})`)
      continue
    }
    try {
      outcomes[s.id] = await recordVerifiedPayment(
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
      )
      logger.warn(`${tag}: paid at ECPay but no notice arrived; recorded (${outcomes[s.id]})`)
    } catch (e) {
      outcomes[s.id] = "error"
      asked.set(s.id, due - 1) // retry this point next run
      logger.error(`${tag}: [ECPAY-ALERT] paid at ECPay but recording failed: ${(e as Error).message}`)
    }
  }
  return outcomes
}

export default async function ecpayPaymentReconcileJob(container: MedusaContainer) {
  // Tests call reconcileEcpayPayments directly; the wall-clock cron must not interleave.
  if (!process.env.ECPAY_ENV || process.env.NODE_ENV === "test") {
    return
  }
  await reconcileEcpayPayments(container)
}

export const config = {
  name: "drn-ecpay-payment-reconcile",
  schedule: "*/10 * * * *",
}
