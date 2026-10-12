// HTTP client for ECPay's B2C e-invoice API (P4-06). Never throws: a missing or unreadable
// answer comes back as { ok: false, transport: true } so callers can look the invoice up
// before deciding anything (ECPay may have acted even when we got no answer).
import type { EcpayInvoiceOptions } from "./config"
import { buildInvoiceRequest, parseInvoiceResponse, type InvoiceResponse } from "./invoice"

const TIMEOUT_MS = 15_000

export async function invoiceCall(
  options: EcpayInvoiceOptions,
  path: "Issue" | "GetIssue" | "Invalid" | "CheckBarcode" | "CheckLoveCode" | "GetCompanyNameByTaxID",
  data: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS
): Promise<InvoiceResponse> {
  const credentials = { merchantId: options.merchantId, hashKey: options.hashKey, hashIV: options.hashIV }
  try {
    const res = await fetch(`${options.apiHost}/B2CInvoice/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInvoiceRequest(credentials, data, new Date())),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    if (res.status === 403) {
      // ECPay rate limit: blocked for about 30 minutes (developers.ecpay.com.tw/7854/).
      return { ok: false, transport: true, message: "HTTP 403 (ECPay rate limit)" }
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return { ok: false, transport: true, message: `HTTP ${res.status}: ${text.slice(0, 120)}` }
    }
    return parseInvoiceResponse(body, credentials)
  } catch (e) {
    return { ok: false, transport: true, message: `no answer (${(e as Error).message})` }
  }
}
