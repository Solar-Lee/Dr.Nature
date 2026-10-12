// ECPay AIO (全方位金流) request/notification helpers (P4-03). Pure functions; no I/O.
// Field rules from developers.ecpay.com.tw/2864/ (order), /2878/ (ReturnURL notice),
// /2890/ (QueryTradeInfo). See docs/research/ecpay.md.
import { MedusaError } from "@medusajs/framework/utils"
import { computeCheckMacValue, verifyCheckMacValue } from "./check-mac-value"

export type EcpayEnvironment = "stage" | "prod"

export const AIO_ENDPOINTS: Record<EcpayEnvironment, { checkout: string; queryTradeInfo: string }> = {
  stage: {
    checkout: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
    queryTradeInfo: "https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5",
  },
  prod: {
    checkout: "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5",
    queryTradeInfo: "https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5",
  },
}

// Credit / ApplePay pay on the ECPay page (P4-03). ATM / CVS / BARCODE first issue a
// payment code (PaymentInfoURL notice) and are paid later (ReturnURL notice) (P4-04).
export const SUPPORTED_CHOOSE_PAYMENT = ["Credit", "ApplePay", "ATM", "CVS", "BARCODE"] as const
export type ChoosePayment = (typeof SUPPORTED_CHOOSE_PAYMENT)[number]
export const OFFLINE_CHOOSE_PAYMENT: readonly ChoosePayment[] = ["ATM", "CVS", "BARCODE"]

// Payment deadlines. ECPay units differ per method (developers.ecpay.com.tw/2872/, /2874/,
// /2876/): ATM ExpireDate in days (1-60), CVS StoreExpireDate in MINUTES (max 43200),
// BARCODE StoreExpireDate in days (1-30). Values below are ECPay's defaults.
// TODO(需 Aki 決定): business payment deadline per method (also used by P4-09 cleanup).
export const PAYMENT_DEADLINES = { atmDays: 3, cvsMinutes: 10080, barcodeDays: 7 }

export type MerchantCredentials = {
  merchantId: string
  hashKey: string
  hashIV: string
}

// ECPay TotalAmount must be a whole number of NTD (no decimals). Fail closed on anything else.
export function toWholeTwd(amount: unknown): number {
  const value = typeof amount === "number" ? amount : Number(String(amount))
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `ECPay requires a positive whole-TWD amount, got ${String(amount)}`
    )
  }
  return value
}

// yyyy/MM/dd HH:mm:ss in Asia/Taipei (UTC+8, no DST), as ECPay requires.
export function formatTaipeiDate(date: Date): string {
  const t = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${t.getUTCFullYear()}/${pad(t.getUTCMonth() + 1)}/${pad(t.getUTCDate())} ` +
    `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`
  )
}

const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

// MerchantTradeNo: letters/digits only, max 20, unique per order and never reused.
// "DN" + yyMMddHHmmss (Taipei) + 6 random base36 chars = 20 chars.
export function newMerchantTradeNo(now: Date, randomBytes: Uint8Array): string {
  if (randomBytes.length < 6) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "need 6 random bytes")
  }
  const stamp = formatTaipeiDate(now).replace(/[/: ]/g, "").slice(2)
  const suffix = Array.from(randomBytes.slice(0, 6), (b) => BASE36[b % 36]).join("")
  return `DN${stamp}${suffix}`
}

export type CheckoutFormInput = {
  credentials: MerchantCredentials
  environment: EcpayEnvironment
  merchantTradeNo: string
  tradeDate: Date
  totalAmount: number
  itemName: string
  tradeDesc: string
  returnUrl: string
  orderResultUrl?: string
  clientBackUrl?: string
  choosePayment: ChoosePayment
  // Echoed back by ECPay in the ReturnURL notice; carries the Medusa payment session id.
  customField1: string
  // Required for ATM / CVS / BARCODE: where ECPay posts the issued payment code.
  paymentInfoUrl?: string
  deadlines?: typeof PAYMENT_DEADLINES
}

export type CheckoutForm = { action: string; fields: Record<string, string> }

// Builds the signed form the browser POSTs to ECPay. Never includes HashKey/HashIV.
export function buildCheckoutForm(input: CheckoutFormInput): CheckoutForm {
  if (!/^[A-Za-z0-9]{1,20}$/.test(input.merchantTradeNo)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "MerchantTradeNo must be 1-20 letters/digits")
  }
  if (!SUPPORTED_CHOOSE_PAYMENT.includes(input.choosePayment)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `unsupported ChoosePayment ${input.choosePayment}`)
  }
  if (input.customField1.length > 50) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "CustomField1 exceeds 50 characters")
  }
  const fields: Record<string, string> = {
    MerchantID: input.credentials.merchantId,
    MerchantTradeNo: input.merchantTradeNo,
    MerchantTradeDate: formatTaipeiDate(input.tradeDate),
    PaymentType: "aio",
    TotalAmount: String(toWholeTwd(input.totalAmount)),
    TradeDesc: input.tradeDesc,
    // ItemName over 400 chars is truncated by ECPay, which breaks CheckMacValue.
    ItemName: input.itemName.slice(0, 400),
    ReturnURL: input.returnUrl,
    ChoosePayment: input.choosePayment,
    EncryptType: "1",
    CustomField1: input.customField1,
  }
  // OrderResultURL is not supported for ATM / CVS / BARCODE (developers.ecpay.com.tw/2864/).
  if (input.orderResultUrl && !OFFLINE_CHOOSE_PAYMENT.includes(input.choosePayment)) {
    fields.OrderResultURL = input.orderResultUrl
  }
  if (input.clientBackUrl) {
    fields.ClientBackURL = input.clientBackUrl
  }
  if (OFFLINE_CHOOSE_PAYMENT.includes(input.choosePayment)) {
    if (!input.paymentInfoUrl) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `${input.choosePayment} requires a PaymentInfoURL`)
    }
    const d = input.deadlines ?? PAYMENT_DEADLINES
    const inRange = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max
    fields.PaymentInfoURL = input.paymentInfoUrl
    if (input.choosePayment === "ATM") {
      if (!inRange(d.atmDays, 1, 60)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "ATM ExpireDate must be 1-60 days")
      }
      fields.ExpireDate = String(d.atmDays)
    } else if (input.choosePayment === "CVS") {
      if (!inRange(d.cvsMinutes, 1, 43200)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "CVS StoreExpireDate must be 1-43200 minutes")
      }
      fields.StoreExpireDate = String(d.cvsMinutes)
    } else {
      if (!inRange(d.barcodeDays, 1, 30)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "BARCODE StoreExpireDate must be 1-30 days")
      }
      fields.StoreExpireDate = String(d.barcodeDays)
    }
  }
  fields.CheckMacValue = computeCheckMacValue(fields, {
    hashKey: input.credentials.hashKey,
    hashIV: input.credentials.hashIV,
    algorithm: "sha256",
  })
  return { action: AIO_ENDPOINTS[input.environment].checkout, fields }
}

export type PaymentNotice = {
  merchantId: string
  merchantTradeNo: string
  rtnCode: string
  tradeNo: string
  tradeAmt: number
  paymentType: string
  paymentDate: string
  simulatePaid: boolean
  sessionId: string
  raw: Record<string, string>
}

// Parses a ReturnURL notice. Returns null when the signature or merchant does not match;
// callers must treat null as "not from ECPay" and must not change any order state.
export function parsePaymentNotice(
  body: Record<string, unknown>,
  credentials: MerchantCredentials
): PaymentNotice | null {
  const raw: Record<string, string> = {}
  for (const [k, v] of Object.entries(body ?? {})) {
    if (typeof v === "string") {
      raw[k] = v
    } else if (typeof v === "number") {
      raw[k] = String(v)
    }
  }
  const ok = verifyCheckMacValue(raw, {
    hashKey: credentials.hashKey,
    hashIV: credentials.hashIV,
    algorithm: "sha256",
  })
  if (!ok || raw.MerchantID !== credentials.merchantId) {
    return null
  }
  const tradeAmt = Number(raw.TradeAmt)
  return {
    merchantId: raw.MerchantID,
    merchantTradeNo: raw.MerchantTradeNo ?? "",
    rtnCode: raw.RtnCode ?? "",
    tradeNo: raw.TradeNo ?? "",
    tradeAmt: Number.isFinite(tradeAmt) ? tradeAmt : NaN,
    paymentType: raw.PaymentType ?? "",
    paymentDate: raw.PaymentDate ?? "",
    // SimulatePaid=1 comes from the vendor back office: RtnCode is 1 but no money moved.
    // A missing field is treated as 0 (real), per docs/research/ecpay.md.
    simulatePaid: raw.SimulatePaid === "1",
    sessionId: raw.CustomField1 ?? "",
    raw,
  }
}

// A notice is a real, completed payment only when every condition holds. Simulated
// payments (vendor back-office) count only when explicitly allowed, which config permits
// in stage alone (ECPAY_ACCEPT_SIMULATED_PAYMENTS) so ATM/CVS can be tested end to end.
export function isPaid(notice: PaymentNotice, expectedAmount: number, acceptSimulated = false): boolean {
  return (
    notice.rtnCode === "1" &&
    (!notice.simulatePaid || acceptSimulated) &&
    Number.isInteger(notice.tradeAmt) &&
    notice.tradeAmt === expectedAmount
  )
}

export type TradeInfo = {
  merchantTradeNo: string
  tradeNo: string
  tradeAmt: number
  tradeStatus: string // "0" unpaid, "1" paid, "10200095" failed / not established
  paymentType: string
  raw: Record<string, string>
}

export function buildQueryTradeInfoRequest(
  credentials: MerchantCredentials,
  merchantTradeNo: string,
  now: Date
): Record<string, string> {
  const fields: Record<string, string> = {
    MerchantID: credentials.merchantId,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: String(Math.floor(now.getTime() / 1000)),
  }
  fields.CheckMacValue = computeCheckMacValue(fields, {
    hashKey: credentials.hashKey,
    hashIV: credentials.hashIV,
    algorithm: "sha256",
  })
  return fields
}

// QueryTradeInfo answers with a key=value&... body despite a text/html content type, and
// its CheckMacValue verifies with this implementation (confirmed against real ECPay stage,
// docs/research/ecpay-stage-probe-2026-10-13.md). Returns null unless signature and merchant match.
export function parseTradeInfoResponse(
  body: string,
  credentials: MerchantCredentials
): TradeInfo | null {
  const raw = Object.fromEntries(new URLSearchParams(body).entries())
  const ok = verifyCheckMacValue(raw, {
    hashKey: credentials.hashKey,
    hashIV: credentials.hashIV,
    algorithm: "sha256",
  })
  if (!ok || raw.MerchantID !== credentials.merchantId) {
    return null
  }
  return {
    merchantTradeNo: raw.MerchantTradeNo ?? "",
    tradeNo: raw.TradeNo ?? "",
    tradeAmt: Number(raw.TradeAmt),
    tradeStatus: raw.TradeStatus ?? "",
    paymentType: raw.PaymentType ?? "",
    raw,
  }
}

// Proof of payment for one session: a CheckMacValue-verified ReturnURL notice (stored by
// the route) or a verified QueryTradeInfo answer (stored by reconciliation, P4-10). Who
// stored it does not matter: it must be signed with our merchant keys and bound to this
// session's MerchantTradeNo, session id and amount, and report a real, completed payment.
export type SessionBinding = { merchantTradeNo: string; sessionId: string; amount: number }

export function verifiedNoticeFor(
  stored: unknown,
  binding: SessionBinding,
  credentials: MerchantCredentials,
  acceptSimulated = false
): PaymentNotice | null {
  if (!stored || typeof stored !== "object") {
    return null
  }
  const notice = parsePaymentNotice(stored as Record<string, unknown>, credentials)
  if (
    !notice ||
    notice.merchantTradeNo !== binding.merchantTradeNo ||
    notice.sessionId !== binding.sessionId ||
    !isPaid(notice, binding.amount, acceptSimulated)
  ) {
    return null
  }
  return notice
}

export function verifiedTradeInfoFor(
  stored: unknown,
  binding: SessionBinding,
  credentials: MerchantCredentials
): TradeInfo | null {
  if (!stored || typeof stored !== "object") {
    return null
  }
  const info = parseTradeInfoResponse(
    new URLSearchParams(stored as Record<string, string>).toString(),
    credentials
  )
  if (
    !info ||
    info.merchantTradeNo !== binding.merchantTradeNo ||
    info.tradeStatus !== "1" ||
    info.tradeAmt !== binding.amount
  ) {
    return null
  }
  return info
}

// ---- PaymentInfoURL (ATM / CVS / BARCODE code issued), developers.ecpay.com.tw/2881/ ----

export type PaymentInfoNotice = {
  merchantTradeNo: string
  sessionId: string
  rtnCode: string
  tradeNo: string
  tradeAmt: number
  paymentType: string
  // ATM
  bankCode?: string
  vAccount?: string
  // CVS
  paymentNo?: string
  // BARCODE
  barcodes?: [string, string, string]
  // Raw ECPay text: "yyyy/MM/dd" for ATM, "yyyy/MM/dd HH:mm:ss" for CVS/BARCODE (Taipei time)
  expireDate: string
  raw: Record<string, string>
}

// Code issued successfully: ATM RtnCode=2, CVS/BARCODE RtnCode=10100073 (not 1).
export function isCodeIssued(info: PaymentInfoNotice): boolean {
  if (info.paymentType.startsWith("ATM")) {
    return info.rtnCode === "2" && !!info.bankCode && !!info.vAccount
  }
  if (info.paymentType.startsWith("CVS")) {
    return info.rtnCode === "10100073" && !!info.paymentNo
  }
  if (info.paymentType.startsWith("BARCODE")) {
    return info.rtnCode === "10100073" && !!info.barcodes?.every((b) => b)
  }
  return false
}

export function parsePaymentInfoNotice(
  body: Record<string, unknown>,
  credentials: MerchantCredentials
): PaymentInfoNotice | null {
  const raw: Record<string, string> = {}
  for (const [k, v] of Object.entries(body ?? {})) {
    if (typeof v === "string" || typeof v === "number") {
      raw[k] = String(v)
    }
  }
  const ok = verifyCheckMacValue(raw, {
    hashKey: credentials.hashKey,
    hashIV: credentials.hashIV,
    algorithm: "sha256",
  })
  if (!ok || raw.MerchantID !== credentials.merchantId) {
    return null
  }
  return {
    merchantTradeNo: raw.MerchantTradeNo ?? "",
    sessionId: raw.CustomField1 ?? "",
    rtnCode: raw.RtnCode ?? "",
    tradeNo: raw.TradeNo ?? "",
    tradeAmt: Number(raw.TradeAmt),
    paymentType: raw.PaymentType ?? "",
    bankCode: raw.BankCode || undefined,
    vAccount: raw.vAccount || undefined,
    paymentNo: raw.PaymentNo || undefined,
    barcodes:
      raw.Barcode1 || raw.Barcode2 || raw.Barcode3
        ? [raw.Barcode1 ?? "", raw.Barcode2 ?? "", raw.Barcode3 ?? ""]
        : undefined,
    expireDate: raw.ExpireDate ?? "",
    raw,
  }
}

// ECPay deadline (Taipei local time) as an ISO instant. A date-only ATM deadline means the
// end of that day (e.g. ordered 7/1 with 3 days -> 7/4 23:59:59). Null if unparseable.
export function paymentDeadlineIso(expireDate: string): string | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(expireDate.trim())
  if (!m) {
    return null
  }
  const [, y, mo, d, h = "23", mi = "59", s = "59"] = m
  const utc = Date.UTC(+y, +mo - 1, +d, +h - 8, +mi, +s)
  return Number.isNaN(utc) ? null : new Date(utc).toISOString()
}

export function verifiedPaymentInfoFor(
  stored: unknown,
  binding: SessionBinding,
  credentials: MerchantCredentials
): PaymentInfoNotice | null {
  if (!stored || typeof stored !== "object") {
    return null
  }
  const info = parsePaymentInfoNotice(stored as Record<string, unknown>, credentials)
  if (
    !info ||
    info.merchantTradeNo !== binding.merchantTradeNo ||
    info.sessionId !== binding.sessionId ||
    info.tradeAmt !== binding.amount ||
    !isCodeIssued(info)
  ) {
    return null
  }
  return info
}
