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
  buildCheckoutForm,
  buildQueryTradeInfoRequest,
  newMerchantTradeNo,
  parseTradeInfoResponse,
  type ChoosePayment,
} from "../lib/ecpay/aio"
import { ecpayOptionsFromEnv } from "../lib/ecpay/config"

const ERROR_MARKERS = ["CheckMacValue", "Error", "錯誤", "參數", "不正確", "失敗"]

export default async function ecpayStageProbe({ args }: ExecArgs) {
  const options = ecpayOptionsFromEnv()
  if (options.environment !== "stage") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "ecpay-stage-probe runs only with ECPAY_ENV=stage")
  }
  const method = ((args ?? [])[0] ?? "ATM") as ChoosePayment
  const credentials = { merchantId: options.merchantId, hashKey: options.hashKey, hashIV: options.hashIV }
  const now = new Date()
  const merchantTradeNo = newMerchantTradeNo(now, crypto.randomBytes(6))
  const form = buildCheckoutForm({
    credentials,
    environment: "stage",
    merchantTradeNo,
    tradeDate: now,
    totalAmount: 1150,
    itemName: `Dr.Nature 訂單 ${merchantTradeNo}`,
    tradeDesc: "Dr.Nature",
    returnUrl: options.returnUrl,
    clientBackUrl: options.clientBackUrl,
    choosePayment: method,
    customField1: "probe",
    paymentInfoUrl: options.paymentInfoUrl,
  })

  const checkout = await fetch(AIO_ENDPOINTS.stage.checkout, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form.fields),
    redirect: "manual",
  })
  const html = await checkout.text()
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  const found = ERROR_MARKERS.filter((m) => text.includes(m))
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    step: "checkout",
    method,
    merchantTradeNo,
    http: checkout.status,
    location: checkout.headers.get("location"),
    title: /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null,
    error_markers: found,
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
  // eslint-disable-next-line no-console
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
