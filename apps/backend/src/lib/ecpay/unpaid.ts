// When an unpaid ECPay order may be canceled (P4-09). Pure.
//  - Credit: N minutes after the order was placed (ECPAY_UNPAID_CANCEL_MINUTES, default 180;
//    after ECPay's 40-minute late-result guidance and the P4-10 2-hour query).
//  - ATM / CVS code / barcode with an issued code: the code's own deadline plus a grace
//    period (ECPay: a barcode payment can take 1-5 business days to show; support /5013/).
//  - Offline method chosen but no code ever issued: 24 hours.
// Before canceling, the caller asks ECPay once more (strict query) and records a payment
// instead if there is one; an unreachable ECPay means "do not cancel".
const MIN = 60 * 1000
const DAY = 24 * 60 * MIN
export const DEFAULT_CREDIT_CANCEL_MINUTES = 180
const OFFLINE_NO_CODE_MS = DAY
const GRACE_MS: Record<string, number> = { ATM: DAY, CVS: DAY, BARCODE: 7 * DAY }

type SessionView = {
  choose_payment?: unknown
  ecpay_payment_instructions?: { payment_type?: unknown; expires_at?: unknown } | null
}

export function creditCancelMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ECPAY_UNPAID_CANCEL_MINUTES ?? DEFAULT_CREDIT_CANCEL_MINUTES)
  return Number.isInteger(n) && n >= 60 ? n : DEFAULT_CREDIT_CANCEL_MINUTES
}

export function cancelAfter(session: SessionView, orderCreatedAt: Date, creditMinutes: number): Date {
  const ins = session.ecpay_payment_instructions
  const expires = typeof ins?.expires_at === "string" ? Date.parse(ins.expires_at) : NaN
  if (Number.isFinite(expires)) {
    const kind = String(ins?.payment_type ?? "").split("_")[0]
    return new Date(expires + (GRACE_MS[kind] ?? DAY))
  }
  if (session.choose_payment === "Credit") {
    return new Date(orderCreatedAt.getTime() + creditMinutes * MIN)
  }
  return new Date(orderCreatedAt.getTime() + OFFLINE_NO_CODE_MS)
}

// An issued offline code that can still be paid (re-pay must not open a second way to pay).
export function liveOfflineCode(session: SessionView, now: Date): boolean {
  const expires = Date.parse(String(session.ecpay_payment_instructions?.expires_at ?? ""))
  return Number.isFinite(expires) && now.getTime() <= expires
}
