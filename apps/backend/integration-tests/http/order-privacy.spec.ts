// [P4-11 review logistics-1] Order privacy: Medusa 2.21.2 serves an order by id alone, so
// non-owners get a masked order (GET /store/orders/:id and the cart-complete response), a
// completed cart is hidden from non-owners, and order transfer is not offered.
//
// What these tests cannot prove: how the storefront uses the masked order (P7-05), analytics
// leakage of order ids (P8-04), and fields a future Medusa adds to its store order query config
// beyond those listed today (the sweep below reads Medusa's own list, so a re-run after an
// upgrade covers the new ones).
//
// Run: cd apps/backend && ../../infra/test-env.sh env TEST_TYPE=integration:http \
//   NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --forceExit integration-tests/http/order-privacy.spec.ts
import { dirname, join } from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import catalog from "../../src/data/catalog.json"
import { ECPAY_PROVIDER_ID } from "../../src/lib/ecpay/config"
import { addTestShipping, makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"

jest.setTimeout(240 * 1000)

const PII = ["buyer@drn.test", "0912345678", "信義路五段7號", "測試", "買家"]
const leaks = (body: unknown) => PII.filter((p) => JSON.stringify(body).includes(p))

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const h = makeCheckoutHelpers({ api, getContainer })

    beforeAll(async () => {
      const container = getContainer()
      await runAllSeeds(container)
      await addTestShipping(container)
      await devAddTestStock({ container, args: [] } as any)
    })

    // A placed order (awaiting payment) by `headers` (guest store headers or a member).
    const placeOrder = async (headers: Record<string, string>, email = "buyer@drn.test") => {
      const { data: r } = await api.get("/store/regions", { headers })
      const { data: p } = await api.get(`/store/products?handle=${catalog.products[0].handle}&fields=*variants`, { headers })
      const { data: c } = await api.post(
        "/store/carts",
        {
          region_id: r.regions[0].id,
          email,
          shipping_address: { first_name: "測試", last_name: "買家", address_1: "信義路五段7號", city: "台北市", postal_code: "110", country_code: "tw", phone: "0912345678" },
        },
        { headers }
      )
      const cartId = c.cart.id as string
      await api.post(`/store/carts/${cartId}/line-items`, { variant_id: p.products[0].variants[0].id, quantity: 1 }, { headers })
      const { data: so } = await api.get(`/store/shipping-options?cart_id=${cartId}`, { headers })
      await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: so.shipping_options.find((o: any) => o.name === "Test home delivery").id }, { headers })
      const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, { headers })
      await api.post(`/store/payment-collections/${pc.payment_collection.id}/payment-sessions`, { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } }, { headers })
      const completed = await api.post(`/store/carts/${cartId}/complete`, {}, { headers, validateStatus: () => true })
      expect(completed.data.type).toEqual("order")
      return { cartId, orderId: completed.data.order.id as string, completed: completed.data }
    }

    const EXTRA = "+cart.id,+customer.email,*payment_collections.payment_sessions"

    it("a guest's order is masked for anyone holding its id, and the complete response is masked too", async () => {
      const guest = await h.storeHeaders()
      const { orderId, completed } = await placeOrder(guest)
      expect(leaks(completed)).toEqual([])
      expect(completed.order.email).toEqual("b***@drn.test")
      const { data } = await api.get(`/store/orders/${orderId}?fields=${EXTRA}`, { headers: guest })
      expect(leaks(data)).toEqual([])
      expect(data.order).toMatchObject({
        email: "b***@drn.test",
        shipping_address: { first_name: "測○", last_name: "買○", phone: "09*****678", address_1: "***" },
      })
      expect(data.order.cart).toBeUndefined()
      expect(data.order.items).toHaveLength(1)
      expect(Number(data.order.total)).toEqual(1150)
      const session = data.order.payment_collections[0].payment_sessions[0]
      expect(Object.keys(session.data).sort()).toEqual(expect.arrayContaining(["checkout_form"]))
      expect(session.data.merchant_trade_no).toBeUndefined()
    })

    it("the logged-in owner sees the full order; another member sees it masked", async () => {
      const owner = await h.registerCustomer("privacy-owner@drn.test")
      const { orderId } = await placeOrder(owner.headers, "privacy-owner@drn.test")
      const mine = await api.get(`/store/orders/${orderId}?fields=${EXTRA}`, { headers: owner.headers })
      expect(mine.data.order.email).toEqual("privacy-owner@drn.test")
      expect(mine.data.order.shipping_address.phone).toEqual("0912345678")
      const other = await h.registerCustomer("privacy-other@drn.test")
      const theirs = await api.get(`/store/orders/${orderId}?fields=${EXTRA}`, { headers: other.headers })
      expect(theirs.data.order.email).toEqual("p***@drn.test")
      expect(theirs.data.order.shipping_address.phone).toEqual("09*****678")
    })

    it("a completed cart is hidden from non-owners (it carries the same e-mail and phone)", async () => {
      const guest = await h.storeHeaders()
      const { cartId } = await placeOrder(guest)
      const res = await api.get(`/store/carts/${cartId}`, { headers: guest, validateStatus: () => true })
      expect(res.status).toEqual(404)
      const owner = await h.registerCustomer("privacy-cart@drn.test")
      const own = await placeOrder(owner.headers, "privacy-cart@drn.test")
      expect((await api.get(`/store/carts/${own.cartId}`, { headers: owner.headers, validateStatus: () => true })).status).toEqual(200)
    })

    it("order transfer is not offered: no order change is left to block fulfillment", async () => {
      const { orderId } = await placeOrder(await h.storeHeaders())
      const stranger = await h.registerCustomer("privacy-transfer@drn.test")
      for (const action of ["request", "cancel", "accept", "decline"]) {
        const res = await api.post(`/store/orders/${orderId}/transfer/${action}`, action === "accept" || action === "decline" ? { token: "x" } : {}, { headers: stranger.headers, validateStatus: () => true })
        expect({ action, status: res.status }).toEqual({ action, status: 404 })
      }
      const { data } = await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph({ entity: "order_change", fields: ["id"], filters: { order_id: orderId } })
      expect(data).toEqual([])
    })

    it("no field Medusa allows on a store order leaks the guest's personal data", async () => {
      const guest = await h.storeHeaders()
      const { orderId } = await placeOrder(guest)
      const medusaDir = dirname(require.resolve("@medusajs/medusa"))
      const { retrieveTransformQueryConfig } = require(join(medusaDir, "api/store/orders/query-config.js"))
      const allowed: string[] = retrieveTransformQueryConfig.allowed
      expect(allowed.length).toBeGreaterThan(20)
      let checked = 0
      for (let i = 0; i < allowed.length; i += 3) {
        const fields = allowed.slice(i, i + 3).map((f) => (f.includes(".") || f.startsWith("*") ? f : `+${f}`)).join(",")
        const res = await api.get(`/store/orders/${orderId}?fields=${encodeURIComponent(fields)}`, { headers: guest, validateStatus: () => true })
        if (res.status !== 200) continue
        checked++
        expect({ fields, leaks: leaks(res.data) }).toEqual({ fields, leaks: [] })
      }
      expect(checked).toBeGreaterThan(10)
    })
  },
})
