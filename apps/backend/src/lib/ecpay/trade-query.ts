// Strict QueryTradeInfo for reconciliation (P4-10) and re-pay (P4-09). Unlike the provider's
// getPaymentStatus, "ECPay unreachable / unsigned answer" is an ERROR here, never "unpaid":
// callers that act on "unpaid" (re-pay deletes the old session, auto-cancel cancels the
// order) must fail closed.
// ECPay publishes no numeric rate limit: calling too fast returns HTTP 403 and the merchant
// must wait 30 minutes (developers.ecpay.com.tw/2890/). After a 403 every query in this
// process pauses for 30 minutes.
import { buildQueryTradeInfoRequest, parseTradeInfoResponse, type TradeInfo } from "./aio"
import type { EcpayProviderOptions as EcpayOptions } from "./config"

const TIMEOUT_MS = 15_000
const PAUSE_AFTER_403_MS = 30 * 60 * 1000

let pausedUntil = 0

export type TradeQuery =
  | { kind: "paid"; info: TradeInfo }
  | { kind: "unpaid"; info: TradeInfo } // signed answer, TradeStatus other than "1"
  | { kind: "error"; message: string; rateLimited?: boolean }

export function tradeQueryPausedUntil(): number {
  return pausedUntil
}

export function resetTradeQueryPause() {
  pausedUntil = 0
}

export async function queryTrade(options: EcpayOptions, merchantTradeNo: string, now = Date.now()): Promise<TradeQuery> {
  if (now < pausedUntil) {
    return { kind: "error", message: `paused after an ECPay 403 until ${new Date(pausedUntil).toISOString()}`, rateLimited: true }
  }
  const credentials = { merchantId: options.merchantId, hashKey: options.hashKey, hashIV: options.hashIV }
  try {
    const res = await fetch(options.queryTradeInfoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(buildQueryTradeInfoRequest(credentials, merchantTradeNo, new Date(now))),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 403) {
      pausedUntil = now + PAUSE_AFTER_403_MS
      return { kind: "error", message: "HTTP 403 (ECPay rate limit; paused 30 minutes)", rateLimited: true }
    }
    const info = parseTradeInfoResponse(await res.text(), credentials)
    if (!info || info.merchantTradeNo !== merchantTradeNo) {
      return { kind: "error", message: `unsigned or foreign answer (HTTP ${res.status})` }
    }
    return info.tradeStatus === "1" ? { kind: "paid", info } : { kind: "unpaid", info }
  } catch (e) {
    return { kind: "error", message: `no answer (${(e as Error).message})` }
  }
}
