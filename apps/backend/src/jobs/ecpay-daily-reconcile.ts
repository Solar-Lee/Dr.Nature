// [P4-07] Daily payment reconciliation against ECPay's TradeNoAio file (developers.ecpay.com.tw/2896/).
// For the previous day (Taipei, by payment date), compares every PAID trade of ours (MerchantTradeNo
// starts with "DN"; the public stage merchant also lists other developers' trades) with Medusa:
//  - paid at ECPay, captured in Medusa                 -> ok
//  - paid at ECPay, session found but not captured     -> one signed QueryTradeInfo to confirm,
//    then recordVerifiedPayment (same path as the ReturnURL route); this catches offline
//    payments (ATM / CVS / barcode) whose notice was lost, which must not be polled (P4-10)
//  - paid at ECPay, no session (replaced by a re-pay, or unknown) -> [ECPAY-ALERT]
//  - amount differs                                    -> [ECPAY-ALERT], nothing recorded
//  - captured in Medusa that day but not paid in the file -> [ECPAY-ALERT]
// One file per run (ECPay allows one per IP per minute). Production needs the server IP
// whitelisted in the ECPay vendor back office (DEV_PLAN U-15).
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { ECPAY_PROVIDER_ID, ecpayOptionsFromEnv } from "../lib/ecpay/config"
import { buildTradeNoAioRequest, parseTradeNoAioCsv, type TradeRow } from "../lib/ecpay/reconcile-file"
import { recordVerifiedPayment } from "../lib/ecpay/record-payment"
import { queryTrade } from "../lib/ecpay/trade-query"

const OUR_PREFIX = "DN"
const DAY_MS = 24 * 60 * 60 * 1000

type SessionRow = { id: string; status: string; payment_collection_id: string; data?: Record<string, unknown> | null }

export type DailyReport = {
  day: string
  file: "ok" | "error"
  error?: string
  paid_at_ecpay: number
  ok: number
  recovered: string[]
  alerts: string[]
}

// Taipei calendar day (yyyy-MM-dd) of an instant.
export const taipeiDay = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10)

export async function reconcileEcpayDay(container: MedusaContainer, day: string): Promise<DailyReport> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const options = ecpayOptionsFromEnv()
  const credentials = { merchantId: options.merchantId, hashKey: options.hashKey, hashIV: options.hashIV }
  const report: DailyReport = { day, file: "ok", paid_at_ecpay: 0, ok: 0, recovered: [], alerts: [] }
  const alert = (msg: string) => {
    report.alerts.push(msg)
    logger.error(`[ECPAY-ALERT] reconcile ${day}: ${msg}`)
  }

  let text: string
  try {
    const res = await fetch(options.tradeNoAioUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(buildTradeNoAioRequest(credentials, { dateType: "2", begin: day, end: day, format: "V1", paymentStatus: "1" })),
      signal: AbortSignal.timeout(30_000),
    })
    text = Buffer.from(await res.arrayBuffer()).toString("utf8")
    if (!res.ok) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `HTTP ${res.status}`)
  } catch (e) {
    report.file = "error"
    report.error = (e as Error).message
    alert(`could not download TradeNoAio: ${report.error}`)
    return report
  }
  const file = parseTradeNoAioCsv(text)
  if (!file.ok) {
    report.file = "error"
    report.error = file.message
    alert(`TradeNoAio answered: ${file.message}`)
    return report
  }
  const paid = file.rows.filter((r) => r.merchantTradeNo.startsWith(OUR_PREFIX) && r.paymentResult === "已付款")
  report.paid_at_ecpay = paid.length

  // Our ECPay sessions from a week before the day to the day after (payment can lag creation).
  const dayStart = new Date(`${day}T00:00:00+08:00`)
  const { data } = await query.graph({
    entity: "payment_session",
    fields: ["id", "status", "payment_collection_id", "data"],
    filters: {
      provider_id: ECPAY_PROVIDER_ID,
      created_at: { $gte: new Date(dayStart.getTime() - 7 * DAY_MS), $lt: new Date(dayStart.getTime() + 2 * DAY_MS) },
    },
  })
  const sessions = data as SessionRow[]
  const byTrade = new Map(sessions.map((s) => [String(s.data?.merchant_trade_no ?? ""), s]))
  const capturedIds = async (ids: string[]) => {
    if (!ids.length) return new Set<string>()
    const { data: payments } = await query.graph({
      entity: "payment",
      fields: ["payment_session_id", "captured_at"],
      filters: { payment_session_id: ids },
    })
    return new Set((payments as { payment_session_id: string; captured_at?: unknown }[]).filter((p) => p.captured_at).map((p) => p.payment_session_id))
  }
  const captured = await capturedIds(sessions.map((s) => s.id))

  for (const row of paid) {
    const s = byTrade.get(row.merchantTradeNo)
    if (!s) {
      alert(`${row.merchantTradeNo} (TradeNo ${row.tradeNo}, NT$${row.amount}) paid at ECPay but has no payment session: refund or match manually`)
      continue
    }
    if (row.amount !== Number(s.data?.amount)) {
      alert(`${row.merchantTradeNo} paid NT$${row.amount} at ECPay but the session expects NT$${String(s.data?.amount)}`)
      continue
    }
    if (captured.has(s.id)) {
      report.ok++
      continue
    }
    await recover(row, s)
  }

  // The other direction: captured in Medusa that day, not listed as paid at ECPay.
  const listed = new Set(paid.map((r) => r.merchantTradeNo))
  const { data: dayPayments } = await query.graph({
    entity: "payment",
    fields: ["payment_session_id", "captured_at", "provider_id"],
    filters: { provider_id: ECPAY_PROVIDER_ID, captured_at: { $gte: dayStart, $lt: new Date(dayStart.getTime() + DAY_MS) } },
  })
  for (const p of dayPayments as { payment_session_id: string }[]) {
    const s = sessions.find((x) => x.id === p.payment_session_id)
    const trade = String(s?.data?.merchant_trade_no ?? "")
    if (trade && !listed.has(trade) && !report.recovered.includes(trade)) {
      alert(`${trade} is captured in Medusa but ECPay does not list it as paid on ${day}`)
    }
  }

  logger.info(`[ECPAY-RECON] ${JSON.stringify(report)}`)
  return report

  async function recover(row: TradeRow, s: SessionRow) {
    const tag = `ECPay reconcile ${row.merchantTradeNo}`
    const r = await queryTrade(options, row.merchantTradeNo)
    if (r.kind !== "paid" || r.info.tradeAmt !== Number(s.data?.amount)) {
      alert(`${row.merchantTradeNo} paid in the file but not confirmed by QueryTradeInfo (${r.kind === "error" ? r.message : r.kind}); check manually`)
      return
    }
    try {
      const outcome = await recordVerifiedPayment(
        container,
        {
          session: { id: s.id, payment_collection_id: s.payment_collection_id },
          proofKey: "ecpay_trade_info",
          proof: r.info.raw,
          merchantTradeNo: row.merchantTradeNo,
          tradeNo: r.info.tradeNo,
          amount: r.info.tradeAmt,
          paymentDate: r.info.raw.PaymentDate ?? row.paymentDate,
        },
        tag
      )
      report.recovered.push(row.merchantTradeNo)
      logger.warn(`${tag}: paid at ECPay (${row.paymentMethod}) but missing in Medusa; recorded (${outcome})`)
    } catch (e) {
      alert(`${row.merchantTradeNo} paid but recording failed: ${(e as Error).message}`)
    }
  }
}

export default async function ecpayDailyReconcileJob(container: MedusaContainer) {
  if (!process.env.ECPAY_ENV || process.env.NODE_ENV === "test") {
    return
  }
  await reconcileEcpayDay(container, taipeiDay(new Date(Date.now() - DAY_MS)))
}

// 02:30 UTC = 10:30 Taipei, for the previous Taipei day.
export const config = {
  name: "drn-ecpay-daily-reconcile",
  schedule: "30 2 * * *",
}
