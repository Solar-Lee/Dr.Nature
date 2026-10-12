// [P5-05] Promotion templates (one test per template), 限時 window, campaign budget, price
// floor, RBAC. Promotions are created through POST /admin/promotion-templates by an
// "operations" user and used through the Store API exactly as the storefront will.
//
// What these tests cannot prove: how the storefront words a promotion (原價, 限時 period),
// which stays a content rule (docs/ops/promotions.md).
//
// Run: cd apps/backend && ../../infra/test-env.sh env TEST_TYPE=integration:http \
//   NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --forceExit integration-tests/http/promotions.spec.ts
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow, createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import catalog from "../../src/data/catalog.json"
import { ECPAY_PROVIDER_ID } from "../../src/lib/ecpay/config"
import { FULFILLMENT_SET_NAME, SALES_CHANNELS } from "../../src/lib/drn-setup"
import { addTestShipping, makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"

jest.setTimeout(180 * 1000)

const HOUR = 3600 * 1000

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const { storeHeaders, superAdminHeaders } = makeCheckoutHelpers({ api, getContainer })

    beforeAll(async () => {
      const container = getContainer()
      await runAllSeeds(container)
      await addTestShipping(container)
      await devAddTestStock({ container, args: [] } as any)
      const fulfillment = container.resolve(Modules.FULFILLMENT)
      const [set] = await fulfillment.listFulfillmentSets({ name: FULFILLMENT_SET_NAME }, { relations: ["service_zones"] })
      const [profile] = await fulfillment.listShippingProfiles({ type: "default" })
      await createShippingOptionsWorkflow(container).run({
        input: [
          {
            name: "Test paid delivery",
            price_type: "flat",
            provider_id: "manual_manual",
            service_zone_id: set.service_zones[0].id,
            shipping_profile_id: profile.id,
            type: { label: "Paid", description: "test", code: "test-paid" },
            prices: [{ currency_code: "twd", amount: 120 }],
            rules: [
              { attribute: "enabled_in_store", value: "true", operator: "eq" },
              { attribute: "is_return", value: "false", operator: "eq" },
            ],
          },
        ],
      })
      const [official] = await container.resolve(Modules.SALES_CHANNEL).listSalesChannels({ name: SALES_CHANNELS.official.name })
      const gift = (handle: string, sku: string, amount: number) => ({
        title: `測試贈品 ${sku}`,
        handle,
        status: "published" as const,
        shipping_profile_id: profile.id,
        options: [{ title: "規格", values: ["一包"] }],
        variants: [{ title: "一包", sku, options: { 規格: "一包" }, manage_inventory: false, prices: [{ currency_code: "twd", amount }] }],
        sales_channels: [{ id: official.id }],
      })
      await createProductsWorkflow(container).run({
        input: { products: [gift("test-gift", "GIFT-TEST-01", 300), gift("test-gift-big", "GIFT-TEST-02", 900)] },
      })
    })

    const product = async (handle: string) => {
      const { data } = await api.get(`/store/products?handle=${handle}&fields=id,*variants`, { headers: await storeHeaders() })
      return { id: data.products[0].id as string, variantId: data.products[0].variants[0].id as string }
    }
    const bottle = () => product(catalog.products[0].handle)
    const bottle2 = () => product(catalog.products[1].handle)

    const createTemplate = async (body: Record<string, unknown>, role = "operations") => {
      const headers = await superAdminHeaders(`promo-${role}-${String(body.code)}-${Math.random()}@drn.test`, role)
      return api.post("/admin/promotion-templates", body, { headers, validateStatus: () => true })
    }

    // A cart with lines [variantId, quantity], optional shipping option (by name).
    const makeCart = async (lines: [string, number][], shipping = "Test home delivery") => {
      const headers = await storeHeaders()
      const { data: r } = await api.get("/store/regions", { headers })
      const { data: c } = await api.post(
        "/store/carts",
        {
          region_id: r.regions[0].id,
          email: "buyer@drn.test",
          shipping_address: {
            first_name: "測試",
            last_name: "買家",
            address_1: "信義路五段7號",
            city: "台北市",
            postal_code: "110",
            country_code: "tw",
            phone: "0912345678",
          },
        },
        { headers }
      )
      const cartId = c.cart.id as string
      for (const [variant_id, quantity] of lines) {
        await api.post(`/store/carts/${cartId}/line-items`, { variant_id, quantity }, { headers })
      }
      const { data: so } = await api.get(`/store/shipping-options?cart_id=${cartId}`, { headers })
      const option = so.shipping_options.find((o: any) => o.name === shipping)
      await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: option.id }, { headers })
      return cartId
    }
    const applyCode = async (cartId: string, code: string) =>
      api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [code] }, { headers: await storeHeaders(), validateStatus: () => true })
    const totals = async (cartId: string) => {
      const { data } = await api.get(`/store/carts/${cartId}`, { headers: await storeHeaders() })
      return { total: Number(data.cart.total), discount: Number(data.cart.discount_total) }
    }
    const complete = async (cartId: string) => {
      const headers = await storeHeaders()
      const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, { headers })
      await api.post(
        `/store/payment-collections/${pc.payment_collection.id}/payment-sessions`,
        { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } },
        { headers }
      )
      return api.post(`/store/carts/${cartId}/complete`, {}, { headers, validateStatus: () => true })
    }

    it("滿額折: NT$200 off from NT$3,000 (tax inclusive), nothing below; the order completes", async () => {
      const b = await bottle()
      expect((await createTemplate({ template: "spend_threshold", code: "SPEND3000", name: "滿三千折兩百", min_total_twd: 3000, amount_off_twd: 200 })).status).toEqual(201)
      const small = await makeCart([[b.variantId, 2]])
      expect((await applyCode(small, "SPEND3000")).status).toEqual(200)
      expect(await totals(small)).toEqual({ total: 2300, discount: 0 })
      const big = await makeCart([[b.variantId, 3]])
      expect((await applyCode(big, "SPEND3000")).status).toEqual(200)
      expect(await totals(big)).toEqual({ total: 3250, discount: 200 })
      const done = await complete(big)
      expect({ status: done.status, type: done.data.type, total: Number(done.data.order?.total) }).toEqual({ status: 200, type: "order", total: 3250 })
    })

    it("第二件折: the 2nd (and 4th) bottle 10% off; a single bottle gets nothing", async () => {
      const b = await bottle()
      expect((await createTemplate({ template: "nth_item", code: "SECOND90", name: "第二件九折", product_ids: [b.id], percent_off: 10 })).status).toEqual(201)
      const one = await makeCart([[b.variantId, 1]])
      await applyCode(one, "SECOND90")
      expect(await totals(one)).toEqual({ total: 1150, discount: 0 })
      const two = await makeCart([[b.variantId, 2]])
      await applyCode(two, "SECOND90")
      expect(await totals(two)).toEqual({ total: 2185, discount: 115 })
      const four = await makeCart([[b.variantId, 4]])
      await applyCode(four, "SECOND90")
      expect(await totals(four)).toEqual({ total: 4370, discount: 230 })
    })

    it("買 X 送 Y: 2 bottles get the gift free; 1 bottle does not; a gift over half the purchase is refused", async () => {
      const b = await bottle()
      const g = await product("test-gift")
      const big = await product("test-gift-big")
      expect((await createTemplate({ template: "buy_x_get_y", code: "BUY2GIFT", name: "買二送隨行包", buy_product_ids: [b.id], buy_quantity: 2, gift_product_ids: [g.id] })).status).toEqual(201)
      const short = await makeCart([[b.variantId, 1], [g.variantId, 1]])
      await applyCode(short, "BUY2GIFT")
      expect(await totals(short)).toEqual({ total: 1450, discount: 0 })
      const ok = await makeCart([[b.variantId, 2], [g.variantId, 1]])
      await applyCode(ok, "BUY2GIFT")
      expect(await totals(ok)).toEqual({ total: 2300, discount: 300 })
      // The free gift is not a bottle: the price floor does not count it.
      expect((await complete(ok)).data.type).toEqual("order")

      const tooRich = await createTemplate({ template: "buy_x_get_y", code: "BUY1BIG", name: "買一送大禮", buy_product_ids: [b.id], buy_quantity: 1, gift_product_ids: [big.id] })
      expect(tooRich.status).toEqual(400)
      expect(tooRich.data.message).toContain("贈品贈獎額度辦法")
    })

    it("免運: a priced delivery becomes free", async () => {
      const b = await bottle()
      expect((await createTemplate({ template: "free_shipping", code: "SHIPFREE", name: "宅配免運" })).status).toEqual(201)
      const cart = await makeCart([[b.variantId, 1]], "Test paid delivery")
      expect(await totals(cart)).toEqual({ total: 1270, discount: 0 })
      await applyCode(cart, "SHIPFREE")
      expect(await totals(cart)).toEqual({ total: 1150, discount: 120 })
    })

    it("限時: only inside the campaign window; a window must have both ends in order", async () => {
      const b = await bottle()
      const now = Date.now()
      const iso = (ms: number) => new Date(ms).toISOString()
      expect((await createTemplate({ template: "spend_threshold", code: "ENDED", name: "已結束", min_total_twd: 1000, amount_off_twd: 100, window: { starts_at: iso(now - 48 * HOUR), ends_at: iso(now - HOUR) } })).status).toEqual(201)
      expect((await createTemplate({ template: "spend_threshold", code: "LATER", name: "未開始", min_total_twd: 1000, amount_off_twd: 100, window: { starts_at: iso(now + HOUR), ends_at: iso(now + 48 * HOUR) } })).status).toEqual(201)
      expect((await createTemplate({ template: "spend_threshold", code: "NOWON", name: "進行中", min_total_twd: 1000, amount_off_twd: 100, window: { starts_at: iso(now - HOUR), ends_at: iso(now + HOUR) } })).status).toEqual(201)
      for (const code of ["ENDED", "LATER"]) {
        const cart = await makeCart([[b.variantId, 1]])
        await applyCode(cart, code)
        expect({ code, ...(await totals(cart)) }).toEqual({ code, total: 1150, discount: 0 })
      }
      const cart = await makeCart([[b.variantId, 1]])
      await applyCode(cart, "NOWON")
      expect(await totals(cart)).toEqual({ total: 1050, discount: 100 })

      const reversed = await createTemplate({ template: "spend_threshold", code: "BACKWARDS", name: "顛倒", min_total_twd: 1000, amount_off_twd: 100, window: { starts_at: iso(now + HOUR), ends_at: iso(now) } })
      expect(reversed.status).toEqual(400)
      const open = await createTemplate({ template: "spend_threshold", code: "OPENEND", name: "沒有結束", min_total_twd: 1000, amount_off_twd: 100, window: { starts_at: iso(now) } })
      expect(open.status).toEqual(400)
    })

    it("預算上限: a 1-order budget lets one order through; the next checkout and cart get no discount", async () => {
      const b = await bottle()
      expect((await createTemplate({ template: "spend_threshold", code: "ONLYONE", name: "限量一單", min_total_twd: 1000, amount_off_twd: 100, budget: { type: "usage", limit: 1 } })).status).toEqual(201)
      const first = await makeCart([[b.variantId, 1]])
      const second = await makeCart([[b.variantId, 1]])
      await applyCode(first, "ONLYONE")
      await applyCode(second, "ONLYONE")
      expect((await totals(second)).discount).toEqual(100) // both carts show it before anyone pays
      expect((await complete(first)).data.type).toEqual("order")
      const late = await complete(second)
      expect(late.status).toEqual(400)
      expect(JSON.stringify(late.data)).toContain("budget")
      const third = await makeCart([[b.variantId, 1]])
      await applyCode(third, "ONLYONE")
      expect(await totals(third)).toEqual({ total: 1150, discount: 0 })
    })

    it("價格下限: promotions that push a bottle below NT$1,035 cannot be checked out", async () => {
      const b = await bottle()
      const b2 = await bottle2()
      expect((await createTemplate({ template: "nth_item", code: "HALFSECOND", name: "第二件五折", product_ids: [b.id], percent_off: 50 })).status).toEqual(201)
      const cart = await makeCart([[b.variantId, 2], [b2.variantId, 1]])
      await applyCode(cart, "HALFSECOND")
      expect(await totals(cart)).toEqual({ total: 2875, discount: 575 }) // 958 per bottle
      const res = await complete(cart)
      expect(res.status).toEqual(400)
      expect(res.data.message).toContain("折扣上限")
    })

    it("only roles with promotion+campaign create may use templates; bad forms and unknown products are refused", async () => {
      const b = await bottle()
      expect((await createTemplate({ template: "free_shipping", code: "SUPPORTNO", name: "x" }, "support")).status).toEqual(403)
      expect((await createTemplate({ template: "free_shipping", code: "FINANCENO", name: "x" }, "finance")).status).toEqual(403)
      const both = await createTemplate({ template: "spend_threshold", code: "BOTHOFF", name: "x", min_total_twd: 1000, amount_off_twd: 100, percent_off: 10 })
      expect(both.status).toEqual(400)
      expect(both.data.message).toContain("exactly one")
      expect((await createTemplate({ template: "spend_threshold", code: "TOOMUCH", name: "x", min_total_twd: 1000, amount_off_twd: 1000 })).status).toEqual(400)
      expect((await createTemplate({ template: "spend_threshold", code: "lowercase", name: "x", min_total_twd: 1000, amount_off_twd: 100 })).status).toEqual(400)
      const ghost = await createTemplate({ template: "nth_item", code: "GHOST", name: "x", product_ids: [b.id, "prod_ghost"], percent_off: 10 })
      expect(ghost.status).toEqual(400)
      expect(ghost.data.message).toContain("prod_ghost")
    })
  },
})
