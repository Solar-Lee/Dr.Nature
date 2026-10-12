// ECPay domestic logistics (物流整合 API) helpers, P4-05. Pure functions; no I/O.
// Facts and sources: docs/research/ecpay.md (LOG-01..LOG-17). Contract: C2C 店到店
// (Aki, 2026-10-13); B2C subtypes are kept for a later switch.
//  - CheckMacValue is MD5 for logistics (not SHA256), with logistics-specific credentials.
//  - The e-map callback (store choice) is NOT signed: treat it as shopper input.
//  - Express/Create answers "1|key=value&..." on success or "0|message" on failure.
//  - Status notices ARE signed and must be answered with exactly "1|OK".
import { MedusaError } from "@medusajs/framework/utils"
import { computeCheckMacValue, verifyCheckMacValue } from "./check-mac-value"
import { formatTaipeiDate, type MerchantCredentials } from "./aio"

export type LogisticsEnvironment = "stage" | "prod"

export const LOGISTICS_HOSTS: Record<LogisticsEnvironment, string> = {
  stage: "https://logistics-stage.ecpay.com.tw",
  prod: "https://logistics.ecpay.com.tw",
}

export const C2C_CVS_SUBTYPES = ["UNIMARTC2C", "FAMIC2C", "HILIFEC2C"] as const
export const B2C_CVS_SUBTYPES = ["UNIMART", "FAMI", "HILIFE"] as const
export const HOME_SUBTYPES = ["TCAT"] as const
export type CvsSubtype = (typeof C2C_CVS_SUBTYPES)[number] | (typeof B2C_CVS_SUBTYPES)[number]
export type HomeSubtype = (typeof HOME_SUBTYPES)[number]

const mac = (c: MerchantCredentials) => ({ hashKey: c.hashKey, hashIV: c.hashIV, algorithm: "md5" as const })

// ---- e-map (store selection) -----------------------------------------------------------

export type MapFormInput = {
  credentials: MerchantCredentials
  environment: LogisticsEnvironment
  subtype: CvsSubtype
  serverReplyUrl: string // storefront page that receives the chosen store (browser POST)
  isMobile: boolean
  extraData?: string // max 20 chars, echoed back
}

export function buildMapForm(input: MapFormInput): { action: string; fields: Record<string, string> } {
  if (input.extraData && input.extraData.length > 20) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "ExtraData exceeds 20 characters")
  }
  // The map request carries no CheckMacValue (developers.ecpay.com.tw/8795/).
  return {
    action: `${LOGISTICS_HOSTS[input.environment]}/Express/map`,
    fields: {
      MerchantID: input.credentials.merchantId,
      LogisticsType: "CVS",
      LogisticsSubType: input.subtype,
      IsCollection: "N",
      ServerReplyURL: input.serverReplyUrl,
      ...(input.extraData ? { ExtraData: input.extraData } : {}),
      Device: input.isMobile ? "1" : "0",
    },
  }
}

export type ChosenStore = {
  subtype: CvsSubtype
  store_id: string
  store_name: string
  store_address: string
  store_telephone?: string
  outlying_island: boolean
}

// Validates the (unsigned) store choice the storefront relays from the e-map callback.
// ECPay itself validates ReceiverStoreID again when the shipment is created.
export function parseChosenStore(data: Record<string, unknown>, expectedSubtype: CvsSubtype): ChosenStore {
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string).trim() : "")
  const subtype = str("LogisticsSubType") || str("subtype")
  const storeId = str("CVSStoreID") || str("store_id")
  const storeName = str("CVSStoreName") || str("store_name")
  const storeAddress = str("CVSAddress") || str("store_address")
  if (subtype !== expectedSubtype) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `store is for ${subtype || "unknown"}, expected ${expectedSubtype}`)
  }
  // ReceiverStoreID is String(6) in Express/Create (developers.ecpay.com.tw/8809/).
  if (!/^[0-9A-Za-z]{1,6}$/.test(storeId)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "invalid convenience-store id")
  }
  if (!storeName || storeName.length > 10 || !storeAddress || storeAddress.length > 60) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "invalid convenience-store name or address")
  }
  const telephone = str("CVSTelephone") || str("store_telephone")
  return {
    subtype: expectedSubtype,
    store_id: storeId,
    store_name: storeName,
    store_address: storeAddress,
    ...(telephone ? { store_telephone: telephone.slice(0, 20) } : {}),
    outlying_island: (str("CVSOutSide") || "0") === "1",
  }
}

// ---- receiver / sender rules (Express/Create) ---------------------------------------------

// ECPay counts a CJK character as 2.
export function displayWidth(s: string): number {
  return [...s].reduce((w, ch) => w + (/[\u3000-\u9fff\uf900-\ufaff]/.test(ch) ? 2 : 1), 0)
}

// Names: 4-10 characters, a CJK character counting as 2 (i.e. 2-5 Chinese characters), no
// digits, symbols or emoji.
export function nameProblem(name: string): string | null {
  const n = name.trim()
  if (!n) {
    return "name is required"
  }
  if (/[0-9]/.test(n) || /[^\p{L}\p{M} ]/u.test(n)) {
    return "name may contain letters only (no digits or symbols)"
  }
  const width = displayWidth(n)
  if (width < 4 || width > 10) {
    return "name must be 2-5 Chinese characters or 4-10 letters"
  }
  return null
}

// Cellphone: 10 digits starting with 09 (+886 accepted).
export function normalizeCellphone(phone: string): string | null {
  const digits = phone.replace(/[\s-]/g, "").replace(/^\+886/, "0")
  return /^09\d{8}$/.test(digits) ? digits : null
}

// GoodsName banned characters (developers.ecpay.com.tw/8809/): ^'`!@#%&*+\"<>|_[]
const GOODS_NAME_BANNED = /[\^'`!@#%&*+\\"<>|_[\]]/

// ---- create shipment (Express/Create) ------------------------------------------------------

export type Party = { name: string; cellphone: string }

export type CreateShipmentInput = {
  credentials: MerchantCredentials
  merchantTradeNo: string
  tradeDate: Date
  goodsAmount: number
  goodsName: string
  sender: Party
  receiver: Party & { email?: string }
  serverReplyUrl: string
} & (
  | { type: "CVS"; subtype: CvsSubtype; storeId: string }
  | { type: "HOME"; subtype: HomeSubtype; senderZip: string; senderAddress: string; receiverZip: string; receiverAddress: string }
)

export function buildCreateShipmentRequest(input: CreateShipmentInput): Record<string, string> {
  if (!/^[A-Za-z0-9]{1,20}$/.test(input.merchantTradeNo)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "MerchantTradeNo must be 1-20 letters/digits")
  }
  if (!Number.isInteger(input.goodsAmount) || input.goodsAmount < 1 || input.goodsAmount > 20000) {
    // ECPay rejects GoodsAmount outside 1-20000 (error 10500040).
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `GoodsAmount must be 1-20000 TWD, got ${input.goodsAmount}`)
  }
  for (const [role, p] of [["sender", input.sender], ["receiver", input.receiver]] as const) {
    const problem = nameProblem(p.name)
    if (problem) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `${role} ${problem}`)
    }
    if (!normalizeCellphone(p.cellphone)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `${role} cellphone must be 09xxxxxxxx`)
    }
  }
  if (GOODS_NAME_BANNED.test(input.goodsName) || displayWidth(input.goodsName) > 50) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "GoodsName has banned characters or is too long")
  }
  const fields: Record<string, string> = {
    MerchantID: input.credentials.merchantId,
    MerchantTradeNo: input.merchantTradeNo,
    MerchantTradeDate: formatTaipeiDate(input.tradeDate),
    LogisticsType: input.type,
    LogisticsSubType: input.subtype,
    GoodsAmount: String(input.goodsAmount),
    IsCollection: "N",
    GoodsName: input.goodsName,
    SenderName: input.sender.name.trim(),
    SenderCellPhone: normalizeCellphone(input.sender.cellphone)!,
    ReceiverName: input.receiver.name.trim(),
    ReceiverCellPhone: normalizeCellphone(input.receiver.cellphone)!,
    ServerReplyURL: input.serverReplyUrl,
  }
  if (input.receiver.email) {
    fields.ReceiverEmail = input.receiver.email
  }
  if (input.type === "CVS") {
    if (!/^[0-9A-Za-z]{1,6}$/.test(input.storeId)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "ReceiverStoreID must be at most 6 letters/digits")
    }
    fields.ReceiverStoreID = input.storeId
  } else {
    for (const [k, v] of [["sender", input.senderAddress], ["receiver", input.receiverAddress]] as const) {
      if (v.trim().length <= 6 || v.trim().length > 60) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `${k} address must be 7-60 characters`)
      }
    }
    Object.assign(fields, {
      SenderZipCode: input.senderZip,
      SenderAddress: input.senderAddress.trim(),
      ReceiverZipCode: input.receiverZip,
      ReceiverAddress: input.receiverAddress.trim(),
      Temperature: "0001",
      Specification: "0001",
      ScheduledPickupTime: "4",
      ScheduledDeliveryTime: "4",
    })
  }
  fields.CheckMacValue = computeCheckMacValue(fields, mac(input.credentials))
  return fields
}

export type CreateShipmentResult =
  | { ok: true; fields: Record<string, string>; signatureVerified: boolean }
  | { ok: false; message: string }

// Parses "1|k=v&..." / "0|message". The success body may carry a CheckMacValue; when it does
// it must verify (a mismatch is treated as failure).
export function parseCreateShipmentResponse(body: string, credentials: MerchantCredentials): CreateShipmentResult {
  const text = body.trim()
  const sep = text.indexOf("|")
  if (sep < 0) {
    return { ok: false, message: `unexpected response: ${text.slice(0, 120)}` }
  }
  const code = text.slice(0, sep).trim()
  const rest = text.slice(sep + 1)
  if (code !== "1") {
    return { ok: false, message: rest.trim().slice(0, 200) || `code ${code}` }
  }
  const fields = Object.fromEntries(new URLSearchParams(rest).entries())
  const signatureVerified = fields.CheckMacValue ? verifyCheckMacValue(fields, mac(credentials)) : false
  if (fields.CheckMacValue && !signatureVerified) {
    return { ok: false, message: "response CheckMacValue mismatch" }
  }
  if (fields.MerchantID && fields.MerchantID !== credentials.merchantId) {
    return { ok: false, message: "response for another merchant" }
  }
  return { ok: true, fields, signatureVerified }
}

// ---- status notices (ServerReplyURL) -------------------------------------------------------

export type LogisticsNotice = {
  merchantTradeNo: string
  allPayLogisticsId: string
  rtnCode: string
  rtnMsg: string
  logisticsType: string
  logisticsSubType: string
  updateStatusDate: string
  cvsPaymentNo?: string
  cvsValidationNo?: string
  bookingNote?: string
  raw: Record<string, string>
}

export function parseLogisticsNotice(
  body: Record<string, unknown>,
  credentials: MerchantCredentials
): LogisticsNotice | null {
  const raw: Record<string, string> = {}
  for (const [k, v] of Object.entries(body ?? {})) {
    if (typeof v === "string" || typeof v === "number") {
      raw[k] = String(v)
    }
  }
  if (!verifyCheckMacValue(raw, mac(credentials)) || raw.MerchantID !== credentials.merchantId) {
    return null
  }
  return {
    merchantTradeNo: raw.MerchantTradeNo ?? "",
    allPayLogisticsId: raw.AllPayLogisticsID ?? "",
    rtnCode: raw.RtnCode ?? "",
    rtnMsg: raw.RtnMsg ?? "",
    logisticsType: raw.LogisticsType ?? "",
    logisticsSubType: raw.LogisticsSubType ?? "",
    updateStatusDate: raw.UpdateStatusDate ?? "",
    cvsPaymentNo: raw.CVSPaymentNo || undefined,
    cvsValidationNo: raw.CVSValidationNo || undefined,
    bookingNote: raw.BookingNote || undefined,
    raw,
  }
}

// What a status code means for the order (developers.ecpay.com.tw/logistics_status/, LOG-13).
export type StatusMeaning = "shipped" | "arrived" | "delivered" | "returning" | "reselect_store" | "canceled" | "info"

const STATUS_MEANING: Record<string, StatusMeaning> = {
  // seller dropped the parcel / logistics center accepted it
  "2068": "shipped", // 7-ELEVEN C2C: 賣家已到門市寄件
  "3032": "shipped", // FamilyMart / Hi-Life C2C: 賣家已到門市寄件
  "2030": "shipped", // 7-ELEVEN / Hi-Life B2C: 物流中心驗收成功
  "3024": "shipped", // FamilyMart / Hi-Life: 物流中心驗收成功
  "3001": "shipped", // TCAT: 轉運中(即集貨)
  // parcel at the pickup store
  "2063": "arrived", // 7-ELEVEN B2C: 包裹配達取件門市
  "2073": "arrived", // 7-ELEVEN C2C: 包裹配達取件門市
  "2098": "arrived", // 7-ELEVEN: 包裹重新配達取件門市
  "3018": "arrived", // FamilyMart / Hi-Life: 包裹配達取件門市
  // picked up / delivered
  "2067": "delivered", // 7-ELEVEN / Hi-Life: 買家已到店取貨
  "3022": "delivered", // FamilyMart / Hi-Life: 買家已到店取貨
  "3003": "delivered", // TCAT: 配完
  // not picked up / returned
  "2074": "returning", // 買家未取包裹，將退回物流中心
  "3020": "returning", // 買家未取包裹，將退回物流中心
  "5004": "returning", // TCAT / Hi-Life: 一般單退回 / 賣家未取包裹
  "5008": "returning", // 退貨配完
  // store closed: the shopper must pick another store
  "2104": "reselect_store",
  "7011": "reselect_store",
  "9999": "canceled",
}

export function statusMeaning(rtnCode: string): StatusMeaning {
  return STATUS_MEANING[rtnCode] ?? "info"
}

// "DL" + yyMMddHHmmss (Taipei) + 6 random base36 = 20 chars; distinct prefix from payment trades.
export function newLogisticsTradeNo(now: Date, randomBytes: Uint8Array): string {
  const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  if (randomBytes.length < 6) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "need 6 random bytes")
  }
  const stamp = formatTaipeiDate(now).replace(/[/: ]/g, "").slice(2)
  return `DL${stamp}${Array.from(randomBytes.slice(0, 6), (b) => BASE36[b % 36]).join("")}`
}
