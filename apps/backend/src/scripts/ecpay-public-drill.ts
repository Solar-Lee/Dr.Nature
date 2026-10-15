// Public-URL ECPay sandbox drill (P12-10a / P12-10). Runs INSIDE drn-backend on the Mac mini
// against ECPay's PUBLIC stage merchants, behind the public HTTPS host, so ECPay's real
// server-to-server callbacks (ReturnURL, PaymentInfoURL) reach this backend. The gate
// (lib/ecpay/public-drill-guard.ts) refuses anything else. `medusa exec` passes positional
// words only, so every mode is a bare word:
//   credit | atm            place an order through the store API on 127.0.0.1:9000 (this process's
//                           own server) and print the auto-submitting ECPay checkout page;
//                           stock for the drill product is topped up to 5 when below 1
//   ship <order_id>         create the C2C shipment at real ECPay stage (Express/Create)
//   status <order_id>       print captured / payment status / proof_keys (KEY NAMES ONLY:
//                           ecpay_notice = ReturnURL, ecpay_payment_info = PaymentInfoURL,
//                           ecpay_trade_info = reconcile query), never the notice contents
//   logistics-notify <order_id> internal|public [bad-mac]
//                           post a self-signed RtnCode=300 status notice for the order's REAL
//                           shipment (the route answers 400 "0|Unknown shipment" otherwise) to
//                           http://127.0.0.1:9000 or to the public URL; bad-mac signs with the
//                           wrong key and must get 400
//   alert-selftest          post a correctly signed PAID notice whose CustomField1 is
//                           drn-selftest-<ts> to the internal ReturnURL: the route answers 400
//                           "0|Session mismatch" and the main process logs one [ECPAY-ALERT]
//                           line, which proves the alert pipeline end to end
// Output: a line ---DRN-DRILL-JSON--- followed by one JSON line; credit/atm add
// ---DRN-DRILL-HTML--- followed by the checkout page. Nothing printed contains HashKey/HashIV.
// Usage (host): drn-docker exec drn-backend /app/node_modules/.bin/medusa exec ./src/scripts/ecpay-public-drill.js credit
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { batchInventoryItemLevelsWorkflow, createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import catalog from "../data/catalog.json"
import { computeCheckMacValue } from "../lib/ecpay/check-mac-value"
import {
  ECPAY_LOGISTICS_PROVIDER_ID,
  ECPAY_LOGISTICS_STATUS_PATH,
  ECPAY_PROVIDER_ID,
  ECPAY_RETURN_PATH,
  ecpayLogisticsOptionsFromEnv,
  ecpayOptionsFromEnv,
} from "../lib/ecpay/config"
import { assertPublicSandboxDrill } from "../lib/ecpay/public-drill-guard"
import { PUBLISHABLE_KEYS, STOCK_LOCATION_NAME } from "../lib/drn-setup"

const INTERNAL_BASE = "http://127.0.0.1:9000"
const PROOF_KEYS = ["ecpay_notice", "ecpay_payment_info", "ecpay_trade_info"] as const
const DRILL_STOCK = 5

// The 7-ELEVEN store ECPay's stage e-map returns (see ecpay-stage-e2e.ts, 2026-10-13).
const STAGE_711_STORE = {
  LogisticsSubType: "UNIMARTC2C",
  CVSStoreID: "238669",
  CVSStoreName: "經貿",
  CVSAddress: "台北市南港區三重路19號1樓",
  CVSOutSide: "0",
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
export function checkoutPageHtml(form: { action: string; fields: Record<string, string> }, title: string): string {
  const inputs = Object.entries(form.fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("")
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><p>${esc(title)}</p><form id="f" method="post" action="${esc(form.action)}">${inputs}<noscript><button>前往綠界付款</button></noscript></form><script>document.getElementById("f").submit()</script>`
}

const emitJson = (o: Record<string, unknown>) => {
  console.log("---DRN-DRILL-JSON---")
  console.log(JSON.stringify(o))
}

type OrderView = {
  id: string
  display_id: number
  created_at: string
  payment_collections?: {
    id: string
    status: string
    payment_sessions?: { id: string; provider_id: string; status: string; data: Record<string, unknown> | null }[]
    payments?: { id: string; captured_at: string | null; amount: unknown }[]
  }[]
  fulfillments?: { id: string; provider_id: string; data: Record<string, unknown> | null }[]
  items?: { id: string; quantity: number }[]
}

export default async function ecpayPublicDrill({ container, args }: ExecArgs) {
  assertPublicSandboxDrill()
  const [mode, orderArg, targetArg, flagArg] = args ?? []
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const loadOrder = async (orderId: string): Promise<OrderView> => {
    if (!orderId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "order id required")
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id", "display_id", "created_at", "items.id", "items.quantity",
        "payment_collections.id", "payment_collections.status",
        "payment_collections.payment_sessions.id", "payment_collections.payment_sessions.provider_id",
        "payment_collections.payment_sessions.status", "payment_collections.payment_sessions.data",
        "payment_collections.payments.id", "payment_collections.payments.captured_at", "payment_collections.payments.amount",
        "fulfillments.id", "fulfillments.provider_id", "fulfillments.data",
      ],
      filters: { id: orderId },
    })
    const order = data[0] as unknown as OrderView | undefined
    if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `order ${orderId} not found`)
    return order
  }

  switch (mode) {
    case "credit":
    case "atm": {
      await ensureDrillStock(container)
      const choosePayment = mode === "credit" ? "Credit" : "ATM"
      const [key] = await container.resolve(Modules.API_KEY).listApiKeys({ title: PUBLISHABLE_KEYS.official, type: "publishable" })
      const h = { "content-type": "application/json", "x-publishable-api-key": key.token }
      const call = async (method: string, path: string, body?: unknown) => {
        const res = await fetch(`${INTERNAL_BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
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
        email: "public-drill@drn.test",
        shipping_address: { first_name: "演練", last_name: "買家", address_1: "信義路五段7號", city: "台北市", postal_code: "110", country_code: "tw", phone: "0912345678" },
      })
      await call("POST", `/store/carts/${cart.id}/line-items`, { variant_id: products[0].variants[0].id, quantity: 1 })
      const { shipping_options } = await call("GET", `/store/shipping-options?cart_id=${cart.id}`)
      const option = shipping_options.find((o: any) => o.provider_id === ECPAY_LOGISTICS_PROVIDER_ID && o.data?.id === "cvs-unimart")
      if (!option) throw new MedusaError(MedusaError.Types.NOT_FOUND, "cvs-unimart shipping option not found (drn-0006)")
      await call("POST", `/store/carts/${cart.id}/shipping-methods`, { option_id: option.id, data: { store: STAGE_711_STORE } })
      const { payment_collection } = await call("POST", "/store/payment-collections", { cart_id: cart.id })
      const { payment_collection: withSession } = await call(
        "POST",
        `/store/payment-collections/${payment_collection.id}/payment-sessions`,
        { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: choosePayment } }
      )
      const session = withSession.payment_sessions[0]
      const done = await call("POST", `/store/carts/${cart.id}/complete`, {})
      if (done.type !== "order") {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `cart completion returned ${done.type}`)
      }
      const form = session.data.checkout_form as { action: string; fields: Record<string, string> }
      emitJson({
        mode,
        order_id: done.order.id,
        display_id: done.order.display_id,
        created_at: done.order.created_at,
        session_id: session.id,
        merchant_trade_no: session.data.merchant_trade_no,
        amount: session.data.amount,
        return_url: form.fields.ReturnURL,
        payment_info_url: form.fields.PaymentInfoURL ?? null,
      })
      console.log("---DRN-DRILL-HTML---")
      console.log(checkoutPageHtml(form, `Dr.Nature 綠界沙箱演練 ${mode} ${String(session.data.merchant_trade_no)}`))
      return
    }

    case "ship": {
      const order = await loadOrder(orderArg)
      const { result } = await createOrderFulfillmentWorkflow(container).run({
        input: { order_id: order.id, items: (order.items ?? []).map((i) => ({ id: i.id, quantity: Number(i.quantity) })) },
      })
      const after = await loadOrder(order.id)
      const f = (after.fulfillments ?? []).find((x) => x.id === result.id)
      const d = (f?.data ?? {}) as Record<string, unknown>
      emitJson({
        mode,
        order_id: order.id,
        fulfillment_id: result.id,
        provider_id: f?.provider_id,
        ecpay_merchant_trade_no: d.ecpay_merchant_trade_no ?? null,
        ecpay_all_pay_logistics_id: d.ecpay_all_pay_logistics_id ?? null,
        ecpay_cvs_payment_no: d.ecpay_cvs_payment_no ?? null,
        ecpay_status: d.ecpay_status ?? null,
      })
      return
    }

    case "status": {
      const order = await loadOrder(orderArg)
      const collections = order.payment_collections ?? []
      const sessions = collections.flatMap((c) => (c.payment_sessions ?? []).filter((s) => s.provider_id === ECPAY_PROVIDER_ID))
      const payments = collections.flatMap((c) => c.payments ?? [])
      emitJson({
        mode,
        order_id: order.id,
        display_id: order.display_id,
        created_at: order.created_at,
        captured: payments.some((p) => !!p.captured_at),
        payment_collection_status: collections.map((c) => c.status),
        sessions: sessions.map((s) => ({
          id: s.id,
          status: s.status,
          merchant_trade_no: s.data?.merchant_trade_no ?? null,
          choose_payment: s.data?.choose_payment ?? null,
          proof_keys: PROOF_KEYS.filter((k) => !!s.data?.[k]),
        })),
        fulfillments: (order.fulfillments ?? []).map((f) => ({ id: f.id, provider_id: f.provider_id, ecpay_status: f.data?.ecpay_status ?? null })),
      })
      return
    }

    case "logistics-notify": {
      const order = await loadOrder(orderArg)
      const target = targetArg === "public" ? "public" : targetArg === "internal" ? "internal" : null
      if (!target) throw new MedusaError(MedusaError.Types.INVALID_DATA, "target must be internal or public")
      const badMac = flagArg === "bad-mac"
      const f = (order.fulfillments ?? []).find((x) => x.provider_id === ECPAY_LOGISTICS_PROVIDER_ID)
      if (!f?.data?.ecpay_merchant_trade_no || !f.data.ecpay_all_pay_logistics_id) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, `order ${order.id} has no ECPay shipment; run ship first`)
      }
      const opt = ecpayLogisticsOptionsFromEnv()
      const fields: Record<string, string> = {
        MerchantID: opt.merchantId,
        MerchantTradeNo: String(f.data.ecpay_merchant_trade_no),
        RtnCode: "300",
        RtnMsg: "訂單處理中(綠界已收到訂單資料)",
        AllPayLogisticsID: String(f.data.ecpay_all_pay_logistics_id),
        LogisticsType: "CVS",
        LogisticsSubType: STAGE_711_STORE.LogisticsSubType,
        GoodsAmount: String(catalog.products[0].price),
        UpdateStatusDate: taipeiNow(),
        CVSPaymentNo: String(f.data.ecpay_cvs_payment_no ?? ""),
        CVSValidationNo: String(f.data.ecpay_cvs_validation_no ?? ""),
      }
      const mac = badMac
        ? { hashKey: "0000000000000000", hashIV: "0000000000000000", algorithm: "md5" as const }
        : { hashKey: opt.hashKey, hashIV: opt.hashIV, algorithm: "md5" as const }
      const body = { ...fields, CheckMacValue: computeCheckMacValue(fields, mac) }
      const base = target === "public" ? opt.statusReplyUrl.replace(ECPAY_LOGISTICS_STATUS_PATH, "") : INTERNAL_BASE
      const res = await fetch(`${base}${ECPAY_LOGISTICS_STATUS_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
      })
      emitJson({ mode, order_id: order.id, target, bad_mac: badMac, url_host: new URL(base).host, http: res.status, body: (await res.text()).slice(0, 80) })
      return
    }

    case "alert-selftest": {
      const opt = ecpayOptionsFromEnv()
      const ts = Date.now()
      const fields: Record<string, string> = {
        MerchantID: opt.merchantId,
        MerchantTradeNo: `DRNSELFTEST${String(ts).slice(-9)}`,
        RtnCode: "1",
        RtnMsg: "交易成功",
        TradeNo: `0${String(ts).slice(-15)}`,
        TradeAmt: "1",
        PaymentType: "Credit_CreditCard",
        PaymentDate: taipeiNow(),
        TradeDate: taipeiNow(),
        SimulatePaid: "0",
        CustomField1: `drn-selftest-${ts}`,
      }
      const body = { ...fields, CheckMacValue: computeCheckMacValue(fields, { hashKey: opt.hashKey, hashIV: opt.hashIV, algorithm: "sha256" }) }
      const res = await fetch(`${INTERNAL_BASE}${ECPAY_RETURN_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
      })
      emitJson({ mode, custom_field1: fields.CustomField1, http: res.status, body: (await res.text()).slice(0, 80), expected: "400 0|Session mismatch, plus one [ECPAY-ALERT] log line in drn-backend" })
      return
    }

    default:
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `unknown mode "${mode ?? ""}"; use credit | atm | ship <order> | status <order> | logistics-notify <order> internal|public [bad-mac] | alert-selftest`
      )
  }
}

function taipeiNow(): string {
  const d = new Date(Date.now() + 8 * 3600_000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

// Tops the drill product's stock up to DRILL_STOCK when it is below 1 (sandbox only; the gate
// has already run). Mirrors dev-add-test-stock.ts for a single SKU.
async function ensureDrillStock(container: ExecArgs["container"]) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const [location] = await container.resolve(Modules.STOCK_LOCATION).listStockLocations({ name: STOCK_LOCATION_NAME })
  if (!location) throw new MedusaError(MedusaError.Types.NOT_FOUND, `stock location "${STOCK_LOCATION_NAME}" not found`)
  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku", "location_levels.location_id", "location_levels.stocked_quantity", "location_levels.reserved_quantity"],
    filters: { sku: catalog.products[0].sku },
  })
  const item = items[0] as { id: string; location_levels?: { location_id: string; stocked_quantity: unknown; reserved_quantity: unknown }[] } | undefined
  if (!item) throw new MedusaError(MedusaError.Types.NOT_FOUND, `inventory item ${catalog.products[0].sku} not found`)
  const level = (item.location_levels ?? []).find((l) => l.location_id === location.id)
  const available = Number(level?.stocked_quantity ?? 0) - Number(level?.reserved_quantity ?? 0)
  if (available >= 1) return
  await batchInventoryItemLevelsWorkflow(container).run({
    input: level
      ? { update: [{ inventory_item_id: item.id, location_id: location.id, stocked_quantity: DRILL_STOCK + Number(level.reserved_quantity ?? 0) }] }
      : { create: [{ inventory_item_id: item.id, location_id: location.id, stocked_quantity: DRILL_STOCK }] },
  })
}
