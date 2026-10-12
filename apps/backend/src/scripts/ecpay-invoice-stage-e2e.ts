// Real-ECPay-stage end-to-end check of e-invoicing (P4-06). Dev only.
// Requires the dev server running with infra/dev-env.sh (store API on MEDUSA_BACKEND_URL;
// e-invoice env = ECPay's PUBLIC sandbox 2000132, whose invoices are never uploaded to the MOF).
//   1. Places an order through the real store API (會員載具) and pays it by posting a
//      correctly signed ReturnURL notice to OUR server (real ECPay cannot reach localhost).
//   2. Waits for OUR subscriber to issue the invoice at real ECPay stage.
//   3. Void + re-issue through OUR workflows (consent recorded as this test; new choice = 統編
//      97025978): the first invoice is voided and a new one is issued under RelateNumber …R1
//      with ECPay's registered company name.
//   4. Cancels the order and voids the re-issued invoice (canceled -> void only).
//   Real GetIssue confirms every state.
// Refuses to run outside NODE_ENV=development against a local database.
// Usage (from apps/backend, dev server running):
//   ../../infra/dev-env.sh pnpm exec medusa exec ./src/scripts/ecpay-invoice-stage-e2e.ts
import type { ExecArgs } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import catalog from "../data/catalog.json"
import { computeCheckMacValue } from "../lib/ecpay/check-mac-value"
import { ECPAY_PROVIDER_ID, ecpayInvoiceOptionsFromEnv, ecpayOptionsFromEnv } from "../lib/ecpay/config"
import { issuedFromGetIssue, type InvoiceRecord } from "../lib/ecpay/invoice"
import { invoiceCall } from "../lib/ecpay/invoice-client"
import { PUBLISHABLE_KEYS } from "../lib/drn-setup"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { issueEcpayInvoiceWorkflow } from "../workflows/ecpay/issue-ecpay-invoice"
import { voidEcpayInvoiceWorkflow } from "../workflows/ecpay/void-ecpay-invoice"

export default async function ecpayInvoiceStageE2e({ container }: ExecArgs) {
  const dbUrl = process.env.DATABASE_URL ?? ""
  if (process.env.NODE_ENV !== "development" || !/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(dbUrl) || process.env.ECPAY_ENV !== "stage") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "ecpay-invoice-stage-e2e runs only in development, against a local DB, with ECPAY_ENV=stage")
  }
  const invoiceOptions = ecpayInvoiceOptionsFromEnv()
  if (invoiceOptions.apiHost !== "https://einvoice-stage.ecpay.com.tw") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "this check must talk to the real ECPay stage host")
  }
  const base = (process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000").replace(/\/$/, "")
  const [key] = await container.resolve(Modules.API_KEY).listApiKeys({ title: PUBLISHABLE_KEYS.official, type: "publishable" })
  const h = { "content-type": "application/json", "x-publishable-api-key": key.token }
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
    const json = (await res.json()) as any
    if (!res.ok) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`)
    }
    return json
  }

  const { regions } = await call("GET", "/store/regions")
  const { products } = await call("GET", `/store/products?handle=${catalog.products[0].handle}&fields=*variants`)
  const { cart } = await call("POST", "/store/carts", {
    region_id: regions[0].id,
    email: "invoice-e2e@drn.test",
    shipping_address: { first_name: "小華", last_name: "陳", address_1: "信義路五段7號", city: "台北市", postal_code: "110", country_code: "tw", phone: "0987654321" },
    metadata: { ecpay_invoice_choice: { type: "member" } },
  })
  await call("POST", `/store/carts/${cart.id}/line-items`, { variant_id: products[0].variants[0].id, quantity: 2 })
  const { shipping_options } = await call("GET", `/store/shipping-options?cart_id=${cart.id}`)
  const cvs = shipping_options.find((o: any) => o.data?.id === "cvs-unimart")
  await call("POST", `/store/carts/${cart.id}/shipping-methods`, {
    option_id: cvs.id,
    data: { store: { LogisticsSubType: "UNIMARTC2C", CVSStoreID: "238669", CVSStoreName: "經貿", CVSAddress: "台北市南港區三重路19號1樓", CVSOutSide: "0" } },
  })
  const { payment_collection } = await call("POST", "/store/payment-collections", { cart_id: cart.id })
  const { payment_collection: pc } = await call("POST", `/store/payment-collections/${payment_collection.id}/payment-sessions`, {
    provider_id: ECPAY_PROVIDER_ID,
    data: { choose_payment: "Credit" },
  })
  const session = pc.payment_sessions[0]
  const done = await call("POST", `/store/carts/${cart.id}/complete`, {})
  const orderId = done.order.id

  // Pay: the ReturnURL notice ECPay would send, signed with the (public sandbox) payment keys.
  const pay = ecpayOptionsFromEnv()
  const fields: Record<string, string> = {
    MerchantID: pay.merchantId,
    MerchantTradeNo: session.data.merchant_trade_no,
    RtnCode: "1",
    RtnMsg: "交易成功",
    TradeNo: "2610130405091234",
    TradeAmt: String(session.data.amount),
    PaymentType: "Credit_CreditCard",
    PaymentDate: "2026/10/13 04:06:00",
    TradeDate: "2026/10/13 04:05:09",
    SimulatePaid: "0",
    CustomField1: session.id,
  }
  const notice = { ...fields, CheckMacValue: computeCheckMacValue(fields, { hashKey: pay.hashKey, hashIV: pay.hashIV, algorithm: "sha256" }) }
  const ack = await (await fetch(`${base}/hooks/ecpay/payment`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(notice) })).text()

  const orderModule = container.resolve(Modules.ORDER)
  let record: InvoiceRecord | undefined
  for (let i = 0; i < 60 && record?.status !== "issued"; i++) {
    await new Promise((r) => setTimeout(r, 500))
    record = (await orderModule.retrieveOrder(orderId, { select: ["id", "metadata"] })).metadata?.ecpay_invoice as InvoiceRecord | undefined
  }
  const issuedAtEcpay = record?.relate_number ? await invoiceCall(invoiceOptions, "GetIssue", { RelateNumber: record.relate_number }) : null
  const before = issuedAtEcpay?.ok ? issuedFromGetIssue(issuedAtEcpay.data) : null

  const consent = { method: "web", note: "stage end-to-end test (no real buyer)" }
  const lookup = async (relate?: string) => {
    if (!relate) return null
    const r = await invoiceCall(invoiceOptions, "GetIssue", { RelateNumber: relate })
    return r.ok ? { ...issuedFromGetIssue(r.data), customer_name: r.data.IIS_Customer_Name, identifier: r.data.IIS_Identifier } : r
  }
  // 3. void + re-issue with a tax id
  await voidEcpayInvoiceWorkflow(container).run({
    input: { order_id: orderId, reason: "stage e2e reissue", consent, actor_id: "stage-e2e", reissue: true, choice: { type: "company", tax_id: "97025978", title: "綠界" } },
  })
  const { result: reissued } = await issueEcpayInvoiceWorkflow(container).run({ input: { order_id: orderId } })
  const afterReissue = (await orderModule.retrieveOrder(orderId, { select: ["id", "metadata"] })).metadata?.ecpay_invoice as InvoiceRecord
  // 4. cancel, then void the re-issued invoice
  await cancelOrderWorkflow(container).run({ input: { order_id: orderId, canceled_by: "stage-e2e" } })
  const { result: finalRecord } = await voidEcpayInvoiceWorkflow(container).run({
    input: { order_id: orderId, reason: "stage e2e cancel", consent, actor_id: "stage-e2e" },
  })
  console.log(JSON.stringify({
    order: done.order.display_id,
    payment_ack: ack,
    first: { status: record?.status, invoice_no: record?.invoice_no, random_number: record?.random_number, sales_amount: record?.sales_amount, ecpay_before: before && { voided: before.voided } },
    first_at_ecpay_after_reissue: await lookup(record?.relate_number),
    reissue: { outcome: reissued.outcome, relate_number: afterReissue?.relate_number, invoice_no: afterReissue?.invoice_no, previous: afterReissue?.previous?.map((p) => p.invoice_no) },
    final: { status: finalRecord.status, consent: finalRecord.void?.consent?.method },
    reissued_at_ecpay_after_void: await lookup(afterReissue?.relate_number),
  }))
}
