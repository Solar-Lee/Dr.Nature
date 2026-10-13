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

// ReceiverEmail is optional, String(50) (developers.ecpay.com.tw/8809/): send it only when it
// is short and well-formed, so one odd address cannot make ECPay refuse the whole shipment.
export function receiverEmail(email: unknown): string | undefined {
  const e = typeof email === "string" ? email.trim() : ""
  return e.length <= 50 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : undefined
}

export type ReceiverAddress = { country_code?: unknown; phone?: unknown; first_name?: unknown; last_name?: unknown }

const text = (v: unknown) => (typeof v === "string" ? v : "")

export function receiverName(address: ReceiverAddress): string {
  return `${text(address.last_name)}${text(address.first_name)}`.trim()
}

// Shopper-facing reason ECPay would refuse this receiver, or null. Checked when the pickup
// option is chosen and again when the cart completes (the address can change in between).
export function receiverProblem(address: ReceiverAddress | null | undefined): string | null {
  if (!address || text(address.country_code).toLowerCase() !== "tw") {
    return "請先填寫台灣收件地址"
  }
  if (!normalizeCellphone(text(address.phone))) {
    return "收件人手機須為 09 開頭的 10 碼號碼"
  }
  if (nameProblem(receiverName(address))) {
    return "收件人姓名須為 2-5 個中文字或 4-10 個英文字母，不可含數字或符號"
  }
  return null
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
  const email = receiverEmail(input.receiver.email)
  if (email) {
    fields.ReceiverEmail = email
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

// `uncertain`: ECPay may have created the shipment even though we cannot use the answer
// (anything but an explicit "0|..." refusal), so staff must check before retrying.
export type CreateShipmentResult =
  | { ok: true; fields: Record<string, string> }
  | { ok: false; message: string; uncertain: boolean }

// Parses "1|k=v&..." / "0|message". A success must be signed (developers.ecpay.com.tw/8809/
// requires checking CheckMacValue), be for our merchant and trade, and carry a shipment id.
export function parseCreateShipmentResponse(
  body: string,
  credentials: MerchantCredentials,
  merchantTradeNo: string
): CreateShipmentResult {
  const text = body.trim()
  const sep = text.indexOf("|")
  if (sep < 0) {
    return { ok: false, message: `unexpected response: ${text.slice(0, 120)}`, uncertain: true }
  }
  const code = text.slice(0, sep).trim()
  const rest = text.slice(sep + 1)
  if (code === "0") {
    return { ok: false, message: rest.trim().slice(0, 200) || "code 0", uncertain: false }
  }
  if (code !== "1") {
    return { ok: false, message: `unexpected response code ${code.slice(0, 20)}`, uncertain: true }
  }
  const fields = Object.fromEntries(new URLSearchParams(rest).entries())
  if (!fields.CheckMacValue || !verifyCheckMacValue(fields, mac(credentials))) {
    return { ok: false, message: "response CheckMacValue missing or wrong", uncertain: true }
  }
  if (fields.MerchantID !== credentials.merchantId || fields.MerchantTradeNo !== merchantTradeNo) {
    return { ok: false, message: "response is for another merchant or trade", uncertain: true }
  }
  if (!fields.AllPayLogisticsID) {
    return { ok: false, message: "response has no AllPayLogisticsID", uncertain: true }
  }
  return { ok: true, fields }
}

// The code the sender and buyer use: 7-ELEVEN C2C 交貨便代碼 is CVSPaymentNo + CVSValidationNo
// (developers.ecpay.com.tw/7418/); FamilyMart / Hi-Life C2C have CVSPaymentNo only; home
// delivery has BookingNote.
export function shipmentCode(f: Record<string, string | undefined>): string {
  return `${f.CVSPaymentNo ?? ""}${f.CVSValidationNo ?? ""}` || f.BookingNote || f.AllPayLogisticsID || ""
}

// ---- query (QueryLogisticsTradeInfo/V5, developers.ecpay.com.tw/7418/) --------------------

export function buildQueryLogisticsTradeInfoRequest(
  credentials: MerchantCredentials,
  merchantTradeNo: string,
  now: Date
): Record<string, string> {
  const fields: Record<string, string> = {
    MerchantID: credentials.merchantId,
    MerchantTradeNo: merchantTradeNo,
    // Valid for 3 minutes.
    TimeStamp: String(Math.floor(now.getTime() / 1000)),
    PlatformID: "",
  }
  fields.CheckMacValue = computeCheckMacValue(fields, mac(credentials))
  return fields
}

// Answer is "k=v&..." (signed). Returns the fields only for a verified answer about this
// merchant's trade that has a shipment id; anything else means "not confirmed".
export function parseLogisticsTradeInfo(
  body: string,
  credentials: MerchantCredentials,
  merchantTradeNo: string
): Record<string, string> | null {
  const fields = Object.fromEntries(new URLSearchParams(body.trim()).entries())
  if (!fields.CheckMacValue || !verifyCheckMacValue(fields, mac(credentials))) {
    return null
  }
  if (fields.MerchantID !== credentials.merchantId || fields.MerchantTradeNo !== merchantTradeNo || !fields.AllPayLogisticsID) {
    return null
  }
  return fields
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

// What a status code means for the order. Source: ECPay status workbook linked from
// developers.ecpay.com.tw/7440/ (C2C sheets for UNIMARTC2C / FAMIC2C / HILIFEC2C, plus TCAT).
// Anything NOT listed is "attention": staff get an alert, so a new or rare code is never silent.
export type StatusMeaning =
  | "progress"
  | "shipped"
  | "arrived"
  | "delivered"
  | "reselect_store"
  | "returning"
  | "lost"
  | "canceled"
  | "attention"

const STATUS_CODES: Record<Exclude<StatusMeaning, "attention">, string[]> = {
  // Normal progress, no action: received / uploaded / sent to store / sorting / weather delay...
  progress: [
    "300", "310", "311", "2000", "2001", "2024", "2025", "2027", "2031", "2041", "2043",
    "2057", "2058", "2059", "2062", "2102", "2105", "7014",
  ],
  // Seller dropped the parcel off, or the logistics center accepted it.
  shipped: ["2068", "3032", "2030", "3024", "3001"],
  // At the pickup store (2098: re-delivered there).
  arrived: ["2073", "3018", "3029", "2063", "2098"],
  // Buyer picked it up (3003: TCAT delivered).
  delivered: ["2067", "3022", "3003"],
  // Pickup or drop-off store closed: a new store must be chosen (Hi-Life 2028: within 3 days).
  reselect_store: ["2104", "7011", "2037", "7032", "2028", "2101", "2103"],

  // Not picked up / going back / back at the sender's store / seller has not collected it.
  returning: [
    "2016", "2026", "2033", "2046", "2047", "2049", "2050", "2053", "2055", "2060", "2065", "2066",
    "2069", "2070", "2072", "2074", "2075", "2076", "2077", "2078", "2079", "2080", "2081", "2082",
    "2083", "2084", "2085", "2086", "2087", "2088", "2089", "2092", "2093", "2096", "2097", "2099",
    "3019", "3020", "3021", "3023", "3025", "3031", "5004", "5008", "7016",
  ],
  // Lost, damaged or destroyed (7035: 逾期未領，貨件銷毀).
  lost: ["2042", "5001", "5002", "7006", "7007", "7008", "7018", "7020", "7035", "7036"],
  canceled: ["9999"],
}

const STATUS_MEANING: Record<string, StatusMeaning> = Object.fromEntries(
  Object.entries(STATUS_CODES).flatMap(([meaning, codes]) => codes.map((c) => [c, meaning as StatusMeaning]))
)

// The SHOPPER's pickup store closed (docs/ops/ecpay-logistics-c2c.md §3). 7032 is OUR sender
// store closing: it also means reselect_store but only staff answer it (return-store route).
export const PICKUP_STORE_CLOSED = ["2104", "7011", "2037", "2028", "2101", "2103"]

export function statusMeaning(rtnCode: string): StatusMeaning {
  return STATUS_MEANING[rtnCode] ?? "attention"
}

// Statuses that need nobody's attention; every other status raises [ECPAY-ALERT].
export function statusNeedsAttention(meaning: StatusMeaning): boolean {
  return !["progress", "shipped", "arrived", "delivered"].includes(meaning)
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

// ---- C2C after shipment (P4-11; docs/research/p4-p5-2026-10-13.md §2) ---------------------

// Change the pickup store (StoreType 01, after a 「門市關轉，請重選門市」 status) or our own
// return/sender store (02). developers.ecpay.com.tw/8907/: success is exactly "1|OK".
export function buildUpdateStoreInfoRequest(
  credentials: MerchantCredentials,
  u: { allPayLogisticsId: string; cvsPaymentNo: string; cvsValidationNo?: string; storeType: "01" | "02"; storeId: string }
): Record<string, string> {
  if (!/^[0-9A-Za-z]{1,6}$/.test(u.storeId)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "store id must be at most 6 letters/digits")
  }
  const fields: Record<string, string> = {
    MerchantID: credentials.merchantId,
    AllPayLogisticsID: u.allPayLogisticsId,
    CVSPaymentNo: u.cvsPaymentNo,
    ...(u.cvsValidationNo ? { CVSValidationNo: u.cvsValidationNo } : {}),
    StoreType: u.storeType,
    ...(u.storeType === "01" ? { ReceiverStoreID: u.storeId } : { ReturnStoreID: u.storeId }),
  }
  fields.CheckMacValue = computeCheckMacValue(fields, mac(credentials))
  return fields
}

// 7-ELEVEN C2C only (developers.ecpay.com.tw/7412/); not possible once the driver collected it.
export function buildCancelC2COrderRequest(
  credentials: MerchantCredentials,
  c: { allPayLogisticsId: string; cvsPaymentNo: string; cvsValidationNo: string }
): Record<string, string> {
  const fields: Record<string, string> = {
    MerchantID: credentials.merchantId,
    AllPayLogisticsID: c.allPayLogisticsId,
    CVSPaymentNo: c.cvsPaymentNo,
    CVSValidationNo: c.cvsValidationNo,
  }
  fields.CheckMacValue = computeCheckMacValue(fields, mac(credentials))
  return fields
}

export const isOkReply = (body: string) => body.trim() === "1|OK"

const PRINT_PATHS: Partial<Record<CvsSubtype, string>> = {
  UNIMARTC2C: "/Express/PrintUniMartC2COrderInfo",
  FAMIC2C: "/Express/PrintFAMIC2COrderInfo",
  HILIFEC2C: "/Express/PrintHILIFEC2COrderInfo",
}

// Shipping slip: ECPay requires a BROWSER form post in a top-level window (no iframe; a server
// POST stalls) — developers.ecpay.com.tw/7406/, /8848/, /8858/, FAQ /62208/. Signed here so
// the HashKey never reaches the browser. Batch = comma-joined, same subtype.
export function buildPrintForm(
  credentials: MerchantCredentials,
  environment: LogisticsEnvironment,
  subtype: CvsSubtype,
  shipments: { allPayLogisticsId: string; cvsPaymentNo: string; cvsValidationNo?: string }[],
  printMode?: "1" | "2"
): { action: string; fields: Record<string, string> } {
  const path = PRINT_PATHS[subtype]
  if (!path || !shipments.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `no C2C slip printing for ${subtype}`)
  }
  const fields: Record<string, string> = {
    MerchantID: credentials.merchantId,
    AllPayLogisticsID: shipments.map((s) => s.allPayLogisticsId).join(","),
    CVSPaymentNo: shipments.map((s) => s.cvsPaymentNo).join(","),
  }
  if (subtype === "UNIMARTC2C") {
    fields.CVSValidationNo = shipments.map((s) => s.cvsValidationNo ?? "").join(",")
    if (printMode) fields.PrintMode = printMode
  }
  fields.CheckMacValue = computeCheckMacValue(fields, mac(credentials))
  return { action: `${LOGISTICS_HOSTS[environment]}${path}`, fields }
}

// Auto-submitting top-level page for the slip (values HTML-escaped).
export function autoSubmitHtml(form: { action: string; fields: Record<string, string> }): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const inputs = Object.entries(form.fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")
  return `<!doctype html><meta charset="utf-8"><title>列印託運單</title><form id="f" method="post" action="${esc(form.action)}">${inputs}<noscript><button>列印託運單</button></noscript></form><script>document.getElementById("f").submit()</script>`
}
