// Real-ECPay-stage end-to-end check of the LOGISTICS provider (P4-05). Dev only.
// Requires the dev server running with infra/dev-env.sh (store API on MEDUSA_BACKEND_URL).
//   1. Places an order through the real store API: 7-ELEVEN C2C pickup at ECPay's stage test
//      store, ECPay payment session (unpaid is fine for shipping tests).
//   2. Runs Medusa's createOrderFulfillmentWorkflow, so OUR provider calls real ECPay stage
//      Express/Create, and prints the stored ECPay shipment ids.
// Refuses to run outside NODE_ENV=development against a local database.
// Usage (from apps/backend, dev server running):
//   ../../infra/dev-env.sh pnpm exec medusa exec ./src/scripts/ecpay-stage-e2e.ts
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import catalog from "../data/catalog.json"
import { ECPAY_LOGISTICS_PROVIDER_ID, ECPAY_PROVIDER_ID } from "../lib/ecpay/config"
import { PUBLISHABLE_KEYS } from "../lib/drn-setup"

// The 7-ELEVEN store ECPay's stage e-map returns (2026-10-13).
const STAGE_711_STORE = {
  LogisticsSubType: "UNIMARTC2C",
  CVSStoreID: "238669",
  CVSStoreName: "經貿",
  CVSAddress: "台北市南港區三重路19號1樓",
  CVSOutSide: "0",
}

export default async function ecpayStageE2e({ container }: ExecArgs) {
  const dbUrl = process.env.DATABASE_URL ?? ""
  if (process.env.NODE_ENV !== "development" || !/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(dbUrl) || process.env.ECPAY_ENV !== "stage") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "ecpay-stage-e2e runs only in development, against a local DB, with ECPAY_ENV=stage")
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
    email: "stage-e2e@drn.test",
    shipping_address: { first_name: "小華", last_name: "陳", address_1: "信義路五段7號", city: "台北市", postal_code: "110", country_code: "tw", phone: "0987654321" },
  })
  await call("POST", `/store/carts/${cart.id}/line-items`, { variant_id: products[0].variants[0].id, quantity: 1 })
  const { shipping_options } = await call("GET", `/store/shipping-options?cart_id=${cart.id}`)
  const option = shipping_options.find((o: any) => o.provider_id === ECPAY_LOGISTICS_PROVIDER_ID && o.data?.id === "cvs-unimart")
  await call("POST", `/store/carts/${cart.id}/shipping-methods`, { option_id: option.id, data: { store: STAGE_711_STORE } })
  const { payment_collection } = await call("POST", "/store/payment-collections", { cart_id: cart.id })
  await call("POST", `/store/payment-collections/${payment_collection.id}/payment-sessions`, { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } })
  const done = await call("POST", `/store/carts/${cart.id}/complete`, {})
  const orderId = done.order.id

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [order] } = await query.graph({ entity: "order", fields: ["id", "display_id", "items.*"], filters: { id: orderId } })
  const { result } = await createOrderFulfillmentWorkflow(container).run({
    input: {
      order_id: orderId,
      items: (order.items ?? []).map((i: any) => ({ id: i.id, quantity: Number(i.quantity ?? i.detail?.quantity) })),
    },
  })
  const { data: [f] } = await query.graph({
    entity: "fulfillment",
    fields: ["id", "provider_id", "data", "labels.tracking_number"],
    filters: { id: result.id },
  })
  const d = (f.data ?? {}) as Record<string, unknown>
  console.log(JSON.stringify({
    order: order.display_id,
    fulfillment_provider: f.provider_id,
    ecpay_all_pay_logistics_id: d.ecpay_all_pay_logistics_id,
    ecpay_cvs_payment_no: d.ecpay_cvs_payment_no,
    ecpay_cvs_validation_no: d.ecpay_cvs_validation_no,
    ecpay_status: d.ecpay_status,
    tracking_number: f.labels?.[0]?.tracking_number,
  }))
}
