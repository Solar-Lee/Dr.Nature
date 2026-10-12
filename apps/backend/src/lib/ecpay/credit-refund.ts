// ECPay credit-card refund decision and requests (P4-08). Pure functions; no I/O.
// Sources (docs/research/p4-p5-2026-10-13.md §1): DoAction /2885/, QueryTrade/V2 /2894/,
// decision table /2883/. BOTH APIs exist in production only — nothing here is verified against
// a live ECPay answer yet; DEV_PLAN P4-08 requires one real transaction before enabling.
// Unclear points are resolved conservatively: anything we cannot decide goes to a human.
//  - TotalAmount for R = the refund amount (ECPay-API-Skill guide; /2885/ is ambiguous);
//    for C / E / N = the authorised amount.
//  - Installment or bonus-point trades: full refunds only (/2885/).
import { computeCheckMacValue } from "./check-mac-value"
import type { MerchantCredentials } from "./aio"

const sha = (c: MerchantCredentials) => ({ hashKey: c.hashKey, hashIV: c.hashIV, algorithm: "sha256" as const })

export type CreditAction = "C" | "R" | "E" | "N"

export function buildQueryCreditTradeRequest(
  credentials: MerchantCredentials,
  q: { gwsr: string; amount: number; checkCode: string }
): Record<string, string> {
  const fields: Record<string, string> = {
    MerchantID: credentials.merchantId,
    CreditRefundId: q.gwsr,
    CreditAmount: String(q.amount),
    CreditCheckCode: q.checkCode,
  }
  fields.CheckMacValue = computeCheckMacValue(fields, sha(credentials))
  return fields
}

export type CreditTrade = { status: string; lastClose?: { status: string; amount: number } }

// JSON {RtnMsg, RtnValue:{status, close_data:[{status, amount, ...}]}}; RtnMsg '' = success.
export function parseQueryCreditTrade(body: unknown): CreditTrade | null {
  const b = (body ?? {}) as { RtnMsg?: unknown; RtnValue?: { status?: unknown; close_data?: unknown } }
  if (b.RtnMsg !== "" || !b.RtnValue || typeof b.RtnValue.status !== "string") {
    return null
  }
  const closes = Array.isArray(b.RtnValue.close_data) ? (b.RtnValue.close_data as { status?: unknown; amount?: unknown }[]) : []
  // The LAST close record with a positive amount decides (/2883/).
  const last = [...closes].reverse().find((c) => Number(c.amount) > 0 && typeof c.status === "string")
  return { status: b.RtnValue.status, ...(last ? { lastClose: { status: String(last.status), amount: Number(last.amount) } } : {}) }
}

export type RefundPlan = { ok: true; steps: { action: CreditAction; amount: number }[] } | { ok: false; reason: string }

// /2883/ decision table, by the last positive close record (or none):
//   none / 已授權 : full -> N            partial -> C(authorised) then R(refund)
//   要關帳       : full -> E then N      partial -> R(refund)
//   已關帳       : R(refund)
//   操作取消     : full -> N            partial -> C(authorised) then R(refund)
export function planCreditRefund(
  trade: CreditTrade,
  p: { authorised: number; refund: number; installmentOrBonus: boolean }
): RefundPlan {
  if (!Number.isInteger(p.refund) || p.refund <= 0 || p.refund > p.authorised) {
    return { ok: false, reason: `refund NT$${p.refund} is not within 1..${p.authorised}` }
  }
  const full = p.refund === p.authorised
  if (p.installmentOrBonus && !full) {
    return { ok: false, reason: "installment / bonus-point trades can only be refunded in full" }
  }
  const state = trade.lastClose?.status ?? (trade.status === "已授權" ? "已授權" : trade.status)
  switch (state) {
    case "已授權":
    case "操作取消":
      return { ok: true, steps: full ? [{ action: "N", amount: p.authorised }] : [{ action: "C", amount: p.authorised }, { action: "R", amount: p.refund }] }
    case "要關帳":
      return { ok: true, steps: full ? [{ action: "E", amount: p.authorised }, { action: "N", amount: p.authorised }] : [{ action: "R", amount: p.refund }] }
    case "已關帳":
      return { ok: true, steps: [{ action: "R", amount: p.refund }] }
    default:
      return { ok: false, reason: `ECPay trade state "${state}" needs a human` }
  }
}

export function buildDoActionRequest(
  credentials: MerchantCredentials,
  a: { merchantTradeNo: string; tradeNo: string; action: CreditAction; amount: number }
): Record<string, string> {
  const fields: Record<string, string> = {
    MerchantID: credentials.merchantId,
    MerchantTradeNo: a.merchantTradeNo,
    TradeNo: a.tradeNo,
    Action: a.action,
    TotalAmount: String(a.amount),
  }
  fields.CheckMacValue = computeCheckMacValue(fields, sha(credentials))
  return fields
}

// Answer is a key=value string; RtnCode 1 = success. ECPay's SDKs do not verify a signature
// on it, and the doc shows none — so it is checked for our merchant and trade only.
export function parseDoActionResponse(body: string, expect: { merchantId: string; merchantTradeNo: string }) {
  const f = Object.fromEntries(new URLSearchParams(body.trim()).entries())
  const ok = f.RtnCode === "1" && f.MerchantID === expect.merchantId && f.MerchantTradeNo === expect.merchantTradeNo
  return { ok, rtnCode: f.RtnCode ?? "", rtnMsg: f.RtnMsg ?? body.slice(0, 120) }
}

// Taipei 20:15-20:30: daily auto-close runs; ECPay says not to call DoAction then (/2885/).
export function inAutoCloseWindow(now: Date): boolean {
  const t = new Date(now.getTime() + 8 * 3600_000)
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes()
  return minutes >= 20 * 60 + 15 && minutes < 20 * 60 + 30
}
