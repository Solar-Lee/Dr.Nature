// Probes the REAL ECPay stage environment with this codebase's signing (P4-04). Stage only.
//   1. POSTs a signed AIO checkout form (as the browser would) and checks ECPay accepts it.
//   2. Calls QueryTradeInfo for that trade and checks the response format and signature,
//      which docs/research/ecpay.md lists as unverified.
// No card data, no logins: it only creates an unpaid stage trade with ECPay's public
// sandbox merchant. Usage (from apps/backend):
//   ../../infra/dev-env.sh pnpm exec medusa exec ./src/scripts/ecpay-stage-probe.ts [ATM|CVS|Credit]
import crypto from "crypto"
import type { ExecArgs } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import {
  AIO_ENDPOINTS,
  buildQueryTradeInfoRequest,
  parseTradeInfoResponse,
  type ChoosePayment,
} from "../lib/ecpay/aio"
import { ecpayOptionsFromEnv } from "../lib/ecpay/config"
import EcpayPaymentProviderService from "../modules/ecpay/service"

const ERROR_MARKERS = ["CheckMacValue", "Error", "錯誤", "參數", "不正確", "失敗"]
// One bottle, in whole TWD (Medusa major units).
const PROBE_TOTAL_TWD = 1150

export default async function ecpayStageProbe({ args }: ExecArgs) {
  const options = ecpayOptionsFromEnv()
  if (options.environment !== "stage") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "ecpay-stage-probe runs only with ECPAY_ENV=stage")
  }
  const method = ((args ?? [])[0] ?? "ATM") as ChoosePayment
  const credentials = { merchantId: options.merchantId, hashKey: options.hashKey, hashIV: options.hashIV }
  // Build the form exactly as shoppers get it: through the payment provider itself, with a
  // realistic Medusa payment-session id in CustomField1.
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as any
  const provider = new EcpayPaymentProviderService({ logger }, options)
  const sessionId = `payses_probe${crypto.randomBytes(8).toString("hex").toUpperCase()}`
  const initiated = await provider.initiatePayment({
    amount: PROBE_TOTAL_TWD,
    currency_code: "twd",
    data: { session_id: sessionId, choose_payment: method },
  })
  const form = (initiated.data as any).checkout_form as { action: string; fields: Record<string, string> }
  const merchantTradeNo = form.fields.MerchantTradeNo

  const checkout = await fetch(form.action, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form.fields),
    redirect: "manual",
  })
  const html = await checkout.text()
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  const found = ERROR_MARKERS.filter((m) => text.includes(m))
  console.log(JSON.stringify({
    step: "checkout",
    method,
    merchantTradeNo,
    form_fields: Object.keys(form.fields),
    http: checkout.status,
    location: checkout.headers.get("location"),
    title: /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null,
    error_markers: found,
    // Where each marker sits, to tell a real refusal from generic page text.
    marker_context: found.map((m) => text.slice(Math.max(0, text.indexOf(m) - 40), text.indexOf(m) + 30)),
    text_sample: text.slice(0, 400),
  }))

  // Always ask the real stage host, ignoring any local stub override.
  const query = await fetch(AIO_ENDPOINTS.stage.queryTradeInfo, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(buildQueryTradeInfoRequest(credentials, merchantTradeNo, new Date())),
  })
  const body = await query.text()
  const parsed = parseTradeInfoResponse(body, credentials)
  console.log(JSON.stringify({
    step: "query_trade_info",
    http: query.status,
    content_type: query.headers.get("content-type"),
    response_keys: [...new URLSearchParams(body).keys()],
    signature_verified: !!parsed,
    trade_status: parsed?.tradeStatus ?? new URLSearchParams(body).get("TradeStatus"),
    trade_amt: parsed?.tradeAmt ?? null,
    raw_sample: body.slice(0, 300),
  }))
}
