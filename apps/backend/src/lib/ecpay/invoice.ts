// ECPay B2C e-invoice (B2CInvoice API) helpers, P4-06. Pure functions; no I/O.
// Facts and sources: docs/research/ecpay.md (INV-01..INV-15) and
// docs/research/ecpay-invoice-p4-06.md.
//  - Own credentials (sandbox 2000132, not the payment or logistics merchant).
//  - JSON envelope {MerchantID, RqHeader:{Timestamp}, Data}; Data is the JSON string,
//    URL-encoded, AES-128-CBC (PKCS7) with HashKey/HashIV as raw 16-byte keys, Base64 (INV-03).
//  - TransCode 1 only means "received"; the business result is Data.RtnCode (1 = success).
import { createCipheriv, createDecipheriv } from "crypto"
import { MedusaError } from "@medusajs/framework/utils"
import type { MerchantCredentials } from "./aio"

export type InvoiceEnvironment = "stage" | "prod"

export const INVOICE_HOSTS: Record<InvoiceEnvironment, string> = {
  stage: "https://einvoice-stage.ecpay.com.tw",
  prod: "https://einvoice.ecpay.com.tw",
}

const keyBytes = (c: MerchantCredentials) => {
  const key = Buffer.from(c.hashKey, "utf8")
  const iv = Buffer.from(c.hashIV, "utf8")
  if (key.length !== 16 || iv.length !== 16) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPay invoice HashKey and HashIV must be 16 characters")
  }
  return { key, iv }
}

// The server URL-decodes after decrypting; encodeURIComponent output decodes exactly
// (the doc's worked example is byte-identical to it).
export function encryptInvoiceData(data: unknown, credentials: MerchantCredentials): string {
  const { key, iv } = keyBytes(credentials)
  const cipher = createCipheriv("aes-128-cbc", key, iv)
  const plain = encodeURIComponent(JSON.stringify(data))
  return Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString("base64")
}

// ECPay encodes its answers .NET-style (space -> "+").
export function decryptInvoiceData(data: string, credentials: MerchantCredentials): unknown {
  const { key, iv } = keyBytes(credentials)
  const decipher = createDecipheriv("aes-128-cbc", key, iv)
  const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")
  return JSON.parse(decodeURIComponent(plain.replace(/\+/g, " ")))
}

export type InvoiceEnvelope = {
  MerchantID: string
  RqHeader: { Timestamp: number }
  Data: string
}

// Timestamp: Unix seconds, valid for 10 minutes (INV-02).
export function buildInvoiceRequest(
  credentials: MerchantCredentials,
  data: Record<string, unknown>,
  now: Date
): InvoiceEnvelope {
  return {
    MerchantID: credentials.merchantId,
    RqHeader: { Timestamp: Math.floor(now.getTime() / 1000) },
    Data: encryptInvoiceData({ MerchantID: credentials.merchantId, ...data }, credentials),
  }
}

export type InvoiceResponse =
  | { ok: true; data: Record<string, unknown> & { RtnCode: number; RtnMsg?: string } }
  | { ok: false; transport: boolean; message: string }

// ok = transport received (TransCode 1) AND business success (Data.RtnCode 1).
// transport=false means ECPay answered with a business refusal we could read.
export function parseInvoiceResponse(body: unknown, credentials: MerchantCredentials): InvoiceResponse {
  const outer = (body ?? {}) as { MerchantID?: unknown; TransCode?: unknown; TransMsg?: unknown; Data?: unknown }
  if (Number(outer.TransCode) !== 1) {
    return { ok: false, transport: true, message: `TransCode ${String(outer.TransCode)}: ${String(outer.TransMsg ?? "")}`.slice(0, 200) }
  }
  if (String(outer.MerchantID ?? "") !== credentials.merchantId || typeof outer.Data !== "string" || !outer.Data) {
    return { ok: false, transport: true, message: "answer is for another merchant or has no Data" }
  }
  let data: Record<string, unknown>
  try {
    data = decryptInvoiceData(outer.Data, credentials) as Record<string, unknown>
  } catch {
    // Wrong key or tampered: AES/PKCS7 or JSON fails.
    return { ok: false, transport: true, message: "Data could not be decrypted" }
  }
  if (Number(data?.RtnCode) !== 1) {
    return { ok: false, transport: false, message: `RtnCode ${String(data?.RtnCode)}: ${String(data?.RtnMsg ?? "")}`.slice(0, 200) }
  }
  return { ok: true, data: data as Record<string, unknown> & { RtnCode: number } }
}

// ---- buyer's invoice choice (stored on the cart, then the order) ---------------------------

// What the shopper picks at checkout. Paper invoices are never issued (Print is always "0").
export type InvoiceChoice =
  | { type: "member" } // 綠界會員載具 (CarrierType 1), keyed to the order e-mail
  | { type: "mobile_barcode"; barcode: string } // 手機條碼 (CarrierType 3)
  | { type: "citizen_cert"; cert: string } // 自然人憑證 (CarrierType 2)
  | { type: "donation"; love_code: string } // 捐贈 (Donation 1)
  | { type: "company"; tax_id: string; title: string } // 統編 + 會員載具, e-mailed

export const DEFAULT_INVOICE_CHOICE: InvoiceChoice = { type: "member" }

// Formats from developers.ecpay.com.tw/7896/ (INV-07, INV-08). Returns a normalized choice
// or a shopper-facing reason in Chinese.
export function parseInvoiceChoice(input: unknown): { ok: true; choice: InvoiceChoice } | { ok: false; message: string } {
  const v = (input ?? {}) as Record<string, unknown>
  const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string).trim() : "")
  switch (v.type) {
    case "member":
      return { ok: true, choice: { type: "member" } }
    case "mobile_barcode": {
      const barcode = s("barcode").toUpperCase()
      return /^\/[0-9A-Z+\-.]{7}$/.test(barcode)
        ? { ok: true, choice: { type: "mobile_barcode", barcode } }
        : { ok: false, message: "手機條碼格式為「/」加 7 碼英數字或 + - ." }
    }
    case "citizen_cert": {
      const cert = s("cert").toUpperCase()
      return /^[A-Z]{2}[0-9]{14}$/.test(cert)
        ? { ok: true, choice: { type: "citizen_cert", cert } }
        : { ok: false, message: "自然人憑證條碼為 2 個英文字母加 14 個數字" }
    }
    case "donation": {
      const love_code = s("love_code")
      return /^[0-9]{3,7}$/.test(love_code)
        ? { ok: true, choice: { type: "donation", love_code } }
        : { ok: false, message: "捐贈碼為 3-7 位數字" }
    }
    case "company": {
      const tax_id = s("tax_id")
      const title = s("title")
      if (!/^[0-9]{8}$/.test(tax_id)) {
        return { ok: false, message: "統一編號為 8 位數字" }
      }
      if (!title || [...title].length > 60) {
        return { ok: false, message: "請填寫公司抬頭（60 字以內）" }
      }
      return { ok: true, choice: { type: "company", tax_id, title } }
    }
    default:
      return { ok: false, message: "請選擇發票類型" }
  }
}

// Data fields that depend on the choice (combination rules INV-08).
export function choiceFields(choice: InvoiceChoice): Record<string, string> {
  const base = { Print: "0", Donation: "0", CarrierType: "1", CarrierNum: "", CustomerIdentifier: "", LoveCode: "" }
  switch (choice.type) {
    case "member":
      return base
    case "mobile_barcode":
      return { ...base, CarrierType: "3", CarrierNum: choice.barcode }
    case "citizen_cert":
      return { ...base, CarrierType: "2", CarrierNum: choice.cert }
    case "donation":
      return { ...base, Donation: "1", CarrierType: "", LoveCode: choice.love_code }
    case "company":
      return { ...base, CustomerIdentifier: choice.tax_id, CustomerName: choice.title }
  }
}

// ---- Issue data from an order --------------------------------------------------------------

export type InvoiceLine = { title: string; quantity: number; total: number }

const ITEM_WORD = "件"
const ITEM_NAME_MAX = 100

// Items must add up to SalesAmount exactly (INV-07). Totals are tax-inclusive TWD and may
// carry decimals after discounts, so amounts are rounded and the rounding remainder goes
// to the largest line.
export function invoiceItems(lines: InvoiceLine[], shippingTotal: number, salesAmount: number) {
  const rows = lines
    .filter((l) => l.quantity > 0)
    .map((l) => ({ name: [...l.title.trim()].slice(0, ITEM_NAME_MAX).join("") || "商品", count: l.quantity, amount: Math.round(l.total) }))
  if (Math.round(shippingTotal) > 0) {
    rows.push({ name: "運費", count: 1, amount: Math.round(shippingTotal) })
  }
  if (!rows.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "invoice has no items")
  }
  const diff = salesAmount - rows.reduce((sum, r) => sum + r.amount, 0)
  if (diff) {
    rows.reduce((max, r) => (r.amount > max.amount ? r : max), rows[0]).amount += diff
  }
  return rows.map((r, i) => ({
    ItemSeq: i + 1,
    ItemName: r.name,
    ItemCount: r.count,
    ItemWord: ITEM_WORD,
    ItemPrice: Math.round((r.amount / r.count) * 100) / 100,
    ItemTaxType: "1",
    ItemAmount: r.amount,
  }))
}

export type IssueInput = {
  relateNumber: string
  email: string
  choice: InvoiceChoice
  salesAmount: number
  lines: InvoiceLine[]
  shippingTotal: number
}

export function buildIssueData(input: IssueInput): Record<string, unknown> {
  if (!/^[A-Za-z0-9]{1,50}$/.test(input.relateNumber)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "RelateNumber must be 1-50 letters/digits")
  }
  if (!Number.isInteger(input.salesAmount) || input.salesAmount < 1) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `SalesAmount must be a positive whole TWD, got ${input.salesAmount}`)
  }
  const email = input.email.trim()
  if (!email || email.length > 80) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "invoice needs the buyer's e-mail (80 characters max)")
  }
  return {
    RelateNumber: input.relateNumber,
    CustomerEmail: email,
    ...choiceFields(input.choice),
    TaxType: "1",
    SalesAmount: input.salesAmount,
    InvType: "07",
    vat: "1",
    Items: invoiceItems(input.lines, input.shippingTotal, input.salesAmount),
  }
}

// ---- order <-> invoice records -------------------------------------------------------------

// One RelateNumber per invoice of an order: the order id without "order_" (a 26-character
// ULID), plus "R<n>" for the n-th re-issue after a void. A retry therefore never issues a
// second invoice: ECPay answers 5070357 「自訂編號重覆」 and GetIssue finds the existing one
// (verified on stage 2026-10-13). RelateNumber is case-insensitive at ECPay; ULIDs are upper.
export function relateNumberFor(orderId: string, sequence = 0): string {
  const id = orderId.replace(/^order_/, "")
  const relate = sequence > 0 ? `${id}R${sequence}` : id
  if (!/^[A-Za-z0-9]{1,50}$/.test(relate) || !Number.isInteger(sequence) || sequence < 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `order id ${orderId} cannot be a RelateNumber`)
  }
  return relate
}

// What we keep on order.metadata.ecpay_invoice (always written as one whole object).
//  pending: to be issued (a re-issue after a staff void), failed: last attempt failed,
//  issued / voided: ECPay's state. `previous` keeps earlier invoices of the order.
export type InvoiceVoid = { at: string; reason: string; consent: { method: string; note: string }; by: string }
export type InvoiceSummary = {
  relate_number: string
  invoice_no?: string
  invoice_date?: string
  random_number?: string
  sales_amount?: number
  void?: InvoiceVoid
}
export type InvoiceRecord = InvoiceSummary & {
  status: "pending" | "issued" | "voided" | "failed"
  sequence?: number
  choice?: InvoiceChoice
  error?: string
  attempts?: number
  updated_at: string
  previous?: InvoiceSummary[]
}

// Issue answer -> invoice fields.
export function issuedFromIssue(data: Record<string, unknown>) {
  return {
    invoice_no: String(data.InvoiceNo ?? ""),
    invoice_date: String(data.InvoiceDate ?? "").replace(/\//g, "-"),
    random_number: String(data.RandomNumber ?? ""),
  }
}

// GetIssue answer (IIS_* fields, developers.ecpay.com.tw/7923/) -> invoice fields + state.
export function issuedFromGetIssue(data: Record<string, unknown>) {
  return {
    invoice_no: String(data.IIS_Number ?? ""),
    invoice_date: String(data.IIS_Create_Date ?? "").replace(/\//g, "-"),
    random_number: String(data.IIS_Random_Number ?? ""),
    relate_number: String(data.IIS_Relate_Number ?? ""),
    sales_amount: Number(data.IIS_Sales_Amount),
    voided: String(data.IIS_Invalid_Status ?? "") === "1",
  }
}

// Invalid needs the issue date as "yyyy-MM-dd" (INV-09).
export function invoiceDay(invoiceDate: string): string {
  const day = invoiceDate.slice(0, 10).replace(/\//g, "-")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `bad invoice date ${invoiceDate}`)
  }
  return day
}
