// When an unpaid ECPay trade is final, and when its order may be canceled (P4-09). Pure: the
// one source for the unpaid-cancel job and re-pay (reviews payments-1, payments-2, cross-1).
//  - Current trade = the NEWEST ECPay session of the collection. Re-pay keeps older trades
//    (a late payment on one still binds to its session); the storefront and the jobs read the
//    newest one as "the" trade.
//  - Anchor = max(order placed, current trade created). The trade's creation is the
//    MerchantTradeDate the provider signed into its checkout form (Taipei, seconds; rewritten
//    whenever updatePayment issues a new trade), else the session's created_at. A re-pay
//    therefore restarts the clock instead of inheriting the order's (payments-1: a credit
//    re-pay at minute 170 was canceled at minute 180, while the shopper was paying).
//  - Final: after this instant ECPay's "unpaid" is final for THAT trade; before it the trade
//    may still turn paid, so re-pay must not open a second way to pay (payments-2):
//      Credit / ApplePay: anchor + 40 min (developers.ecpay.com.tw/2890/, /2887/: query a credit
//        trade 40 minutes after creation, bank results can lag; docs/research/p4-p5-2026-10-13.md
//        §1). TODO(需查證): ECPay does not publish how long its credit payment page stays open.
//      ATM / CVS code / barcode with an issued code: the code's deadline + 1 day (ATM, CVS) or
//        + 7 days (barcode status takes 1-5 business days to update; support /5013/).
//      Offline method chosen but no code recorded: anchor + 24 h (an issued code reaches us as
//        a PaymentInfoURL notice that ECPay retries).
//    TradeStatus 10200095 is NOT treated as final: ECPay does not document it as terminal.
//  - Cancel: online = max(final, anchor + ECPAY_UNPAID_CANCEL_MINUTES, default 180; after the
//    P4-10 2-hour query); offline = final.
// Before canceling, the caller asks ECPay about every trade of the order (strict query) and
// records a payment instead if there is one; an unreachable ECPay means "do not cancel".
const MIN = 60 * 1000
const DAY = 24 * 60 * MIN
export const DEFAULT_CREDIT_CANCEL_MINUTES = 180
// Paid on ECPay's own page, answered at once (no code to issue).
export const ONLINE_CHOOSE_PAYMENT: readonly string[] = ["Credit", "ApplePay"]
const ONLINE_FINAL_MS = 40 * MIN
const OFFLINE_NO_CODE_MS = DAY
const GRACE_MS: Record<string, number> = { ATM: DAY, CVS: DAY, BARCODE: 7 * DAY }
// TODO(需 Aki 決定): how many ECPay trades one order may open (the original + re-pays).
export const MAX_ECPAY_TRADES = 5

type SessionView = {
  choose_payment?: unknown
  ecpay_payment_instructions?: { payment_type?: unknown; expires_at?: unknown } | null
}
type TradeSession = { created_at: string | Date; data?: Record<string, unknown> | null }

export function creditCancelMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ECPAY_UNPAID_CANCEL_MINUTES ?? DEFAULT_CREDIT_CANCEL_MINUTES)
  return Number.isInteger(n) && n >= 60 ? n : DEFAULT_CREDIT_CANCEL_MINUTES
}

// "yyyy/MM/dd HH:mm:ss" or "yyyy-MM-dd HH:mm:ss" in Taipei time (UTC+8, no DST); null otherwise.
export function taipeiInstant(s: unknown): Date | null {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(s ?? "").trim())
  if (!m) {
    return null
  }
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +m[6])
  return Number.isNaN(t) ? null : new Date(t)
}

export function tradeCreatedAt(s: TradeSession): Date {
  const form = (s.data?.checkout_form ?? null) as { fields?: Record<string, unknown> } | null
  return taipeiInstant(form?.fields?.MerchantTradeDate) ?? new Date(s.created_at)
}

export function anchorOf(orderCreatedAt: Date, s: TradeSession): Date {
  return new Date(Math.max(orderCreatedAt.getTime(), tradeCreatedAt(s).getTime()))
}

export const isOnlineTrade = (d: SessionView) => ONLINE_CHOOSE_PAYMENT.includes(String(d.choose_payment))

export function tradeFinalAt(d: SessionView, anchor: Date): Date {
  const ins = d.ecpay_payment_instructions
  const expires = Date.parse(String(ins?.expires_at ?? ""))
  if (Number.isFinite(expires)) {
    const kind = String(ins?.payment_type ?? "").split("_")[0]
    return new Date(expires + (GRACE_MS[kind] ?? DAY))
  }
  return new Date(anchor.getTime() + (isOnlineTrade(d) ? ONLINE_FINAL_MS : OFFLINE_NO_CODE_MS))
}

export function cancelAfter(d: SessionView, anchor: Date, creditMinutes: number): Date {
  const final = tradeFinalAt(d, anchor)
  return isOnlineTrade(d) ? new Date(Math.max(final.getTime(), anchor.getTime() + creditMinutes * MIN)) : final
}

// An issued offline code that can still be paid (re-pay must not open a second way to pay).
export function liveOfflineCode(session: SessionView, now: Date): boolean {
  const expires = Date.parse(String(session.ecpay_payment_instructions?.expires_at ?? ""))
  return Number.isFinite(expires) && now.getTime() <= expires
}

export function ecpayTradesNewestFirst<S extends { provider_id: string; created_at: string | Date }>(sessions: S[], providerId: string): S[] {
  return sessions
    .filter((s) => s.provider_id === providerId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

// A signed payment proof is attached (the provider keeps only proofs that verify for the session).
export const hasProof = (s: { data?: Record<string, unknown> | null }) => !!(s.data?.ecpay_notice || s.data?.ecpay_trade_info)
