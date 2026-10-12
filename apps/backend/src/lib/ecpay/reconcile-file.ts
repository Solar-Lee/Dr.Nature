// ECPay daily reconciliation file TradeNoAio (P4-07, developers.ecpay.com.tw/2896/). Pure
// functions; no I/O. Vendor host (not the payment host); POST form; SHA256 CheckMacValue;
// answers a CSV. Production: the calling IP must be whitelisted in the ECPay vendor back
// office, one file per IP per minute.
import { computeCheckMacValue } from "./check-mac-value"
import type { MerchantCredentials } from "./aio"

export const TRADENOAIO_HOSTS = {
  stage: "https://vendor-stage.ecpay.com.tw/PaymentMedia/TradeNoAio",
  prod: "https://vendor.ecpay.com.tw/PaymentMedia/TradeNoAio",
} as const

export type TradeNoAioQuery = {
  // 2 = payment date, 4 = allocation date, 6 = order date
  dateType: "2" | "4" | "6"
  begin: string // yyyy-MM-dd
  end: string // yyyy-MM-dd
  format: "V1" | "V2" | "V3"
  paymentStatus?: "0" | "1" | "2" // unpaid / paid / failed
}

const FORMAT_CODE = { V1: "0", V2: "1", V3: "2" } as const

export function buildTradeNoAioRequest(credentials: MerchantCredentials, q: TradeNoAioQuery): Record<string, string> {
  const fields: Record<string, string> = {
    MerchantID: credentials.merchantId,
    DateType: q.dateType,
    BeginDate: q.begin,
    EndDate: q.end,
    MediaFormated: FORMAT_CODE[q.format],
    CharSet: "2", // UTF-8
    ...(q.paymentStatus ? { PaymentStatus: q.paymentStatus } : {}),
  }
  fields.CheckMacValue = computeCheckMacValue(fields, { hashKey: credentials.hashKey, hashIV: credentials.hashIV, algorithm: "sha256" })
  return fields
}

// ---- parsing (format seen on real stage 2026-10-13, V1, UTF-8 with BOM) ----------------------
// Header: 交易日期,綠界交易序號,特店訂單編號,ATM條碼,交易金額,付款方式,付款結果,付款日期,
// 款項來源(銀行/超商),通路費,交易服務費率(%數 / $筆),交易服務費金額,應收款項(淨額),撥款狀態,
// 撥款日期,備註,交易處理費 — rows end with a trailing comma; ATM條碼 is Excel-quoted (="...").
// An error (e.g. "一分鐘之內僅限下載一個媒體檔") comes back as a row whose only value is 備註.

export type TradeRow = {
  tradeDate: string
  tradeNo: string
  merchantTradeNo: string
  amount: number
  paymentMethod: string
  paymentResult: string
  paymentDate: string
}

export type TradeFile = { ok: true; rows: TradeRow[] } | { ok: false; message: string }

const REQUIRED = ["交易日期", "綠界交易序號", "特店訂單編號", "交易金額", "付款方式", "付款結果", "付款日期", "備註"]

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ",") {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  // Excel text guard: ="..." -> ...
  return out.map((v) => v.replace(/^=(?=")/, "").replace(/^"(.*)"$/, "$1").trim())
}

export function parseTradeNoAioCsv(text: string): TradeFile {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) {
    return { ok: false, message: "empty file" }
  }
  const header = splitCsvLine(lines[0])
  const idx = Object.fromEntries(REQUIRED.map((h) => [h, header.indexOf(h)]))
  const missing = REQUIRED.filter((h) => idx[h] < 0)
  if (missing.length) {
    return { ok: false, message: `unexpected header (missing ${missing.join(", ")}): ${lines[0].slice(0, 120)}` }
  }
  const rows: TradeRow[] = []
  for (const line of lines.slice(1)) {
    const v = splitCsvLine(line)
    if (!v[idx["綠界交易序號"]] && !v[idx["特店訂單編號"]] && v[idx["備註"]]) {
      return { ok: false, message: v[idx["備註"]] }
    }
    rows.push({
      tradeDate: v[idx["交易日期"]] ?? "",
      tradeNo: v[idx["綠界交易序號"]] ?? "",
      merchantTradeNo: v[idx["特店訂單編號"]] ?? "",
      amount: Number(v[idx["交易金額"]]),
      paymentMethod: v[idx["付款方式"]] ?? "",
      paymentResult: v[idx["付款結果"]] ?? "",
      paymentDate: v[idx["付款日期"]] ?? "",
    })
  }
  return { ok: true, rows }
}
