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

// Methods enabled for P4-03. ATM / CVS / BARCODE need PaymentInfoURL handling (P4-04).
export const SUPPORTED_CHOOSE_PAYMENT = ["Credit", "ApplePay"] as const
export type ChoosePayment = (typeof SUPPORTED_CHOOSE_PAYMENT)[number]

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
  if (input.orderResultUrl) {
    fields.OrderResultURL = input.orderResultUrl
  }
  if (input.clientBackUrl) {
    fields.ClientBackURL = input.clientBackUrl
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

// A notice is a real, completed payment only when every condition holds.
export function isPaid(notice: PaymentNotice, expectedAmount: number): boolean {
  return (
    notice.rtnCode === "1" &&
    !notice.simulatePaid &&
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

// QueryTradeInfo answers with a key=value&... body (assumed; confirm in stage, see
// docs/research/ecpay.md). Returns null unless the signature and merchant match.
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
  credentials: MerchantCredentials
): PaymentNotice | null {
  if (!stored || typeof stored !== "object") {
    return null
  }
  const notice = parsePaymentNotice(stored as Record<string, unknown>, credentials)
  if (
    !notice ||
    notice.merchantTradeNo !== binding.merchantTradeNo ||
    notice.sessionId !== binding.sessionId ||
    !isPaid(notice, binding.amount)
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
