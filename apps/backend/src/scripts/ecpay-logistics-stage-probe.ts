// Probes the REAL ECPay logistics stage environment with this codebase's MD5 signing
// (P4-05). Stage only; ECPay's PUBLIC C2C sandbox merchant (developers.ecpay.com.tw/7398/).
//   1. POSTs the e-map form (stage returns a fixed store without showing a map) and reads
//      the store fields ECPay would post back.
//   2. Creates a C2C shipment (Express/Create) to that store and parses the "1|..." answer.
//   3. Queries that trade and an unknown one (QueryLogisticsTradeInfo/V5) and checks signatures.
// Only test data; no logins. Usage (from apps/backend):
//   ../../infra/dev-env.sh pnpm exec medusa exec ./src/scripts/ecpay-logistics-stage-probe.ts [UNIMARTC2C|FAMIC2C|HILIFEC2C] [storeId]
import crypto from "crypto"
import type { ExecArgs } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import {
  LOGISTICS_HOSTS,
  buildCreateShipmentRequest,
  buildQueryLogisticsTradeInfoRequest,
  buildMapForm,
  newLogisticsTradeNo,
  parseCreateShipmentResponse,
  parseLogisticsTradeInfo,
  type CvsSubtype,
} from "../lib/ecpay/logistics"

// ECPay PUBLIC C2C sandbox merchant (developers.ecpay.com.tw/7398/); not a secret.
const C2C_SANDBOX = { merchantId: "2000933", hashKey: "XBERn1YOvpM9nfZc", hashIV: "h1ONHk4P4yqbl5LK" }

const hiddenInputs = (html: string) => {
  const out: Record<string, string> = {}
  for (const m of html.matchAll(/<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi)) {
    out[m[1]] = m[2]
  }
  return out
}

export default async function ecpayLogisticsStageProbe({ args }: ExecArgs) {
  if (process.env.ECPAY_ENV !== "stage") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "logistics stage probe runs only with ECPAY_ENV=stage")
  }
  const subtype = ((args ?? [])[0] ?? "UNIMARTC2C") as CvsSubtype
  const map = buildMapForm({
    credentials: C2C_SANDBOX,
    environment: "stage",
    subtype,
    serverReplyUrl: "https://example.invalid/checkout/ecpay/cvs-store",
    isMobile: false,
    extraData: "probe",
  })
  const mapRes = await fetch(map.action, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(map.fields),
    redirect: "manual",
  })
  const mapHtml = await mapRes.text()
  const store = hiddenInputs(mapHtml)
  console.log(JSON.stringify({
    step: "map",
    subtype,
    http: mapRes.status,
    location: mapRes.headers.get("location"),
    form_action: /<form[^>]*action=["']([^"']+)["']/i.exec(mapHtml)?.[1] ?? null,
    store_fields: store,
    text_sample: mapHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200),
  }))

  // Stage forwards to each carrier's test map; the fixed test store is read from that page
  // and can be passed as the second argument (e.g. 7-ELEVEN stage store 238669).
  const storeId = store.CVSStoreID ?? (args ?? [])[1]
  if (!storeId) {
    return
  }
  const request = buildCreateShipmentRequest({
    credentials: C2C_SANDBOX,
    merchantTradeNo: newLogisticsTradeNo(new Date(), crypto.randomBytes(6)),
    tradeDate: new Date(),
    goodsAmount: 1150,
    goodsName: "Dr.Nature 保健食品",
    sender: { name: "王小明", cellphone: "0912345678" },
    receiver: { name: "陳小華", cellphone: "0987654321" },
    serverReplyUrl: "https://example.invalid/hooks/ecpay/logistics",
    type: "CVS",
    subtype,
    storeId,
  })
  const createRes = await fetch(`${LOGISTICS_HOSTS.stage}/Express/Create`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(request),
  })
  const body = await createRes.text()
  const merchantTradeNo = request.MerchantTradeNo
  const parsed = parseCreateShipmentResponse(body, C2C_SANDBOX, merchantTradeNo)
  const loose = Object.fromEntries(new URLSearchParams(body.slice(body.indexOf("|") + 1)).entries())
  console.log(JSON.stringify({
    step: "create",
    subtype,
    http: createRes.status,
    content_type: createRes.headers.get("content-type"),
    ok: parsed.ok,
    message: parsed.ok ? null : parsed.message,
    response_keys: Object.keys(loose),
    merchant_trade_no_echoed: loose.MerchantTradeNo === merchantTradeNo,
    status: { RtnCode: loose.RtnCode, RtnMsg: loose.RtnMsg },
    has_ids: { AllPayLogisticsID: !!loose.AllPayLogisticsID, CVSPaymentNo: !!loose.CVSPaymentNo, CVSValidationNo: !!loose.CVSValidationNo },
  }))

  for (const [label, tradeNo] of [["created", merchantTradeNo], ["unknown", "DLPROBE0000000000000"]] as const) {
    const q = await fetch(`${LOGISTICS_HOSTS.stage}/Helper/QueryLogisticsTradeInfo/V5`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(buildQueryLogisticsTradeInfoRequest(C2C_SANDBOX, tradeNo, new Date())),
    })
    const qBody = await q.text()
    const info = parseLogisticsTradeInfo(qBody, C2C_SANDBOX, tradeNo)
    console.log(JSON.stringify({
      step: "query",
      trade: label,
      http: q.status,
      content_type: q.headers.get("content-type"),
      verified: !!info,
      response_keys: [...new URLSearchParams(qBody).keys()],
      logistics_status: info?.LogisticsStatus ?? null,
      same_shipment: info ? info.AllPayLogisticsID === loose.AllPayLogisticsID : null,
      raw_sample: label === "unknown" ? qBody.slice(0, 160) : null,
    }))
  }
}
