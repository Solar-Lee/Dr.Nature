// P4-03 acceptance: ECPay credit-card flow end to end through the real store API and the
// ReturnURL route. ECPay itself is replaced by a local QueryTradeInfo stub on
// ECPAY_API_BASE_URL (infra/test-env.sh) that signs its answers with the PUBLIC sandbox
// keys; notices are signed the same way. What this cannot prove: ECPay's real stage
// servers accepting our form and calling our ReturnURL (needs a public HTTPS URL; P4-04).
//
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
import http from "http"
import { readdirSync } from "fs"
import { join } from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { IRbacModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, generateJwtToken } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { computeCheckMacValue, verifyCheckMacValue } from "../../src/lib/ecpay/check-mac-value"
import { ECPAY_PROVIDER_ID } from "../../src/lib/ecpay/config"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import catalog from "../../src/data/catalog.json"
import {
  FULFILLMENT_SET_NAME,
  PUBLISHABLE_KEYS,
  STOCK_LOCATION_NAME,
} from "../../src/lib/drn-setup"

jest.setTimeout(180 * 1000)

const MAC = {
  hashKey: process.env.ECPAY_HASH_KEY as string,
  hashIV: process.env.ECPAY_HASH_IV as string,
  algorithm: "sha256" as const,
}
const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID as string
const STUB_URL = new URL(process.env.ECPAY_API_BASE_URL as string)

// ---- QueryTradeInfo stub ---------------------------------------------------------------
type Trade = { status: string; amount: number }
const trades = new Map<string, Trade>()
let stubRequests = 0
let stubBadSignatures = 0
const stub = http.createServer((req, res) => {
  let raw = ""
  req.on("data", (c) => (raw += c))
  req.on("end", () => {
    stubRequests++
    const params = Object.fromEntries(new URLSearchParams(raw))
    if (req.url !== "/Cashier/QueryTradeInfo/V5" || !verifyCheckMacValue(params, MAC)) {
      stubBadSignatures++
      res.writeHead(400).end("bad request")
      return
    }
    const t = trades.get(params.MerchantTradeNo) ?? { status: "10200095", amount: 0 }
    const fields = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: params.MerchantTradeNo,
      TradeNo: `T${params.MerchantTradeNo.slice(-10)}`,
      TradeAmt: String(t.amount),
      TradeStatus: t.status,
      PaymentType: "Credit_CreditCard",
    }
    res.writeHead(200, { "content-type": "text/html" })
    res.end(new URLSearchParams({ ...fields, CheckMacValue: computeCheckMacValue(fields, MAC) }).toString())
  })
})

// ---- helpers ---------------------------------------------------------------------------
const MIGRATION_DIR = join(__dirname, "../../src/migration-scripts")
const runAllSeeds = async (container: MedusaContainer) => {
  const files = readdirSync(MIGRATION_DIR)
    .filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith(".d.ts"))
    .sort((a, b) => a.localeCompare(b))
  for (const f of files) {
    await (await import(join(MIGRATION_DIR, f))).default({ container })
  }
}

// Test-only home delivery option; ECPay logistics replaces this in P4-05.
const addTestShipping = async (container: MedusaContainer) => {
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const fulfillment = container.resolve(Modules.FULFILLMENT)
  const [location] = await container.resolve(Modules.STOCK_LOCATION).listStockLocations({ name: STOCK_LOCATION_NAME })
  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  })
  const [set] = await fulfillment.listFulfillmentSets({ name: FULFILLMENT_SET_NAME }, { relations: ["service_zones"] })
  const [profile] = await fulfillment.listShippingProfiles({ type: "default" })
  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Test home delivery",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: set.service_zones[0].id,
        shipping_profile_id: profile.id,
        type: { label: "Test", description: "test", code: "test" },
        prices: [{ currency_code: "twd", amount: 0 }],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
    ],
  })
}

const signedNotice = (overrides: Record<string, string>) => {
  const fields = {
    MerchantID: MERCHANT_ID,
    RtnCode: "1",
    RtnMsg: "交易成功",
    TradeNo: "2610130105091234",
    PaymentType: "Credit_CreditCard",
    PaymentDate: "2026/10/13 01:06:00",
    TradeDate: "2026/10/13 01:05:09",
    SimulatePaid: "0",
    ...overrides,
  }
  return { ...fields, CheckMacValue: computeCheckMacValue(fields, MAC) }
}

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    beforeAll(async () => {
      await new Promise<void>((resolve) => stub.listen(Number(STUB_URL.port), STUB_URL.hostname, resolve))
      const container = getContainer()
      await runAllSeeds(container)
      await addTestShipping(container)
      await devAddTestStock({ container, args: [] } as any)
    })
    afterAll(async () => {
      await new Promise<void>((resolve) => stub.close(() => resolve()))
    })
    beforeEach(() => {
      trades.clear()
      stubRequests = 0
      stubBadSignatures = 0
    })

    const storeHeaders = async () => {
      const [key] = await getContainer()
        .resolve(Modules.API_KEY)
        .listApiKeys({ title: PUBLISHABLE_KEYS.official, type: "publishable" })
      return { "x-publishable-api-key": key.token }
    }

    const superAdminHeaders = async (email: string) => {
      const container = getContainer()
      const user = await container.resolve(Modules.USER).createUsers({ email })
      const identity = await container.resolve(Modules.AUTH).createAuthIdentities({
        provider_identities: [{ provider: "emailpass", entity_id: email }],
        app_metadata: { user_id: user.id },
      })
      const [role] = await container.resolve<IRbacModuleService>(Modules.RBAC).listRbacRoles({ name: "Super Admin" })
      await container.resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.USER]: { user_id: user.id },
        [Modules.RBAC]: { rbac_role_id: role.id },
      })
      const { http: httpConfig } = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig
      const token = generateJwtToken(
        { actor_id: user.id, actor_type: "user", auth_identity_id: identity.id, app_metadata: { user_id: user.id, roles: [role.id] } },
        { secret: httpConfig.jwtSecret as string, expiresIn: "1d" }
      )
      return { authorization: `Bearer ${token}` }
    }

    // Store checkout up to an order awaiting payment (or stop before completing the cart).
    const checkout = async ({ complete = true }: { complete?: boolean } = {}) => {
      const headers = await storeHeaders()
      const { data: r } = await api.get("/store/regions", { headers })
      const regionId = r.regions[0].id
      const { data: p } = await api.get(`/store/products?handle=${catalog.products[0].handle}&fields=*variants`, { headers })
      const { data: c } = await api.post(
        "/store/carts",
        {
          region_id: regionId,
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
      const cartId = c.cart.id
      await api.post(`/store/carts/${cartId}/line-items`, { variant_id: p.products[0].variants[0].id, quantity: 1 }, { headers })
      const { data: so } = await api.get(`/store/shipping-options?cart_id=${cartId}`, { headers })
      await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: so.shipping_options[0].id }, { headers })
      const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, { headers })
      const { data: ps } = await api.post(
        `/store/payment-collections/${pc.payment_collection.id}/payment-sessions`,
        { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } },
        { headers }
      )
      const session = ps.payment_collection.payment_sessions[0]
      const paymentCollectionId = pc.payment_collection.id
      if (!complete) {
        return { cartId, session, sessionData: session.data, completion: null as any, paymentCollectionId, headers }
      }
      const { data: done } = await api.post(`/store/carts/${cartId}/complete`, {}, { headers })
      return { cartId, session, sessionData: session.data, completion: done, paymentCollectionId, headers }
    }

    const postNotice = (body: Record<string, string>) =>
      api.post("/hooks/ecpay/payment", new URLSearchParams(body).toString(), {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        validateStatus: () => true,
      })

    const capturedPayments = async (sessionId: string) => {
      const { data } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "payment", fields: ["id", "captured_at", "amount"], filters: { payment_session_id: sessionId } })
      return data.filter((p: any) => p.captured_at)
    }

    const paidNotice = (sessionData: any, session: any, extra: Record<string, string> = {}) =>
      signedNotice({
        MerchantTradeNo: sessionData.merchant_trade_no,
        TradeAmt: String(sessionData.amount),
        CustomField1: session.id,
        ...extra,
      })

    it("region offers ECPay only (pp_system_default removed)", async () => {
      const headers = await storeHeaders()
      const { data } = await api.get("/store/regions?fields=*payment_providers", { headers })
      expect(data.regions[0].payment_providers.map((p: any) => p.id)).toEqual([ECPAY_PROVIDER_ID])
    })

    it("session carries a signed checkout form and no merchant keys", async () => {
      const { session, sessionData } = await checkout()
      const form = sessionData.checkout_form
      expect(form.action).toEqual("https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5")
      expect(form.fields).toMatchObject({
        MerchantID: MERCHANT_ID,
        TotalAmount: String(catalog.products[0].price),
        ChoosePayment: "Credit",
        CustomField1: session.id,
        ReturnURL: "http://localhost:9000/hooks/ecpay/payment",
      })
      expect(verifyCheckMacValue(form.fields, MAC)).toBe(true)
      expect(JSON.stringify(session)).not.toContain(MAC.hashKey)
      expect(JSON.stringify(session)).not.toContain(MAC.hashIV)
    })

    it("completing the cart before payment creates an order awaiting payment", async () => {
      const { completion, session } = await checkout()
      expect(completion.type).toEqual("order")
      expect(await capturedPayments(session.id)).toHaveLength(0)
      expect(stubRequests).toEqual(0) // no ECPay round-trip in the checkout hot path
    })

    it("signed paid notice -> exactly '1|OK' and the order's payment is captured (no ECPay query)", async () => {
      const { session, sessionData, completion } = await checkout()
      // QueryTradeInfo would still say "unpaid" (ECPay documents a lag): the signed notice is the proof.
      trades.set(sessionData.merchant_trade_no, { status: "0", amount: sessionData.amount })
      const res = await postNotice(paidNotice(sessionData, session))
      expect(res.status).toEqual(200)
      expect(res.data).toEqual("1|OK")
      const captured = await capturedPayments(session.id)
      expect(captured).toHaveLength(1)
      expect(Number(captured[0].amount)).toEqual(sessionData.amount)
      const { data: order } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "order", fields: ["id", "payment_collections.status"], filters: { id: completion.order.id } })
      expect(order[0].payment_collections?.[0]?.status).toEqual("completed")
      expect(stubRequests).toEqual(0)
    })

    it("duplicate paid notice is acknowledged again without a second payment", async () => {
      const { session, sessionData } = await checkout()
      trades.set(sessionData.merchant_trade_no, { status: "1", amount: sessionData.amount })
      const body = paidNotice(sessionData, session)
      expect((await postNotice(body)).data).toEqual("1|OK")
      expect((await postNotice(body)).data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(1)
    })

    it("tampered notice (amount edited after signing) -> 400, nothing captured", async () => {
      const { session, sessionData } = await checkout()
      trades.set(sessionData.merchant_trade_no, { status: "1", amount: sessionData.amount })
      const res = await postNotice({ ...paidNotice(sessionData, session), TradeAmt: "1" })
      expect(res.status).toEqual(400)
      expect(res.data).not.toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(0)
    })

    it("notice signed with another merchant's keys -> 400, nothing captured", async () => {
      const { session, sessionData } = await checkout()
      trades.set(sessionData.merchant_trade_no, { status: "1", amount: sessionData.amount })
      const fields = { ...paidNotice(sessionData, session) }
      delete (fields as any).CheckMacValue
      const forged = {
        ...fields,
        CheckMacValue: computeCheckMacValue(fields, { ...MAC, hashKey: "5294y06JbISpM5x9", hashIV: "v77hoKGq4kWxNNIS" }),
      }
      expect((await postNotice(forged)).status).toEqual(400)
      expect(await capturedPayments(session.id)).toHaveLength(0)
    })

    it("notice pointing at another session's trade -> 400 session mismatch", async () => {
      const a = await checkout()
      const b = await checkout()
      const res = await postNotice(paidNotice(a.sessionData, b.session))
      expect(res.status).toEqual(400)
      expect(await capturedPayments(a.session.id)).toHaveLength(0)
      expect(await capturedPayments(b.session.id)).toHaveLength(0)
    })

    it.each([
      ["SimulatePaid=1", { SimulatePaid: "1" }],
      ["RtnCode != 1", { RtnCode: "10100248", RtnMsg: "拒絕交易" }],
    ])("%s is acknowledged but captures nothing", async (_n, extra) => {
      const { session, sessionData } = await checkout()
      trades.set(sessionData.merchant_trade_no, { status: "1", amount: sessionData.amount })
      const res = await postNotice(paidNotice(sessionData, session, extra))
      expect(res.data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(0)
    })

    it("signed notice with a different amount is acknowledged but never captured", async () => {
      const { session, sessionData } = await checkout()
      trades.set(sessionData.merchant_trade_no, { status: "1", amount: 1 })
      const res = await postNotice(paidNotice(sessionData, session, { TradeAmt: "1" }))
      expect(res.data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(0)
    })

    it("re-paying an already placed order through a new session is refused", async () => {
      const { paymentCollectionId, headers } = await checkout()
      const res = await api.post(
        `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
        { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } },
        { headers, validateStatus: () => true }
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(JSON.stringify(res.data)).toContain("already been placed")
    })

    it("paid notice before the cart was completed creates the order and captures it", async () => {
      const { session, sessionData, cartId } = await checkout({ complete: false })
      const res = await postNotice(paidNotice(sessionData, session))
      expect(res.data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(1)
      const { data: links } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "order_cart", fields: ["cart_id"], filters: { cart_id: cartId } })
      expect(links).toHaveLength(1)
    })

    it("payment arriving for a canceled order is recorded on the order, alerted and not captured", async () => {
      const { session, sessionData, completion } = await checkout()
      const admin = await superAdminHeaders("cancel@drn.test")
      const cancel = await api.post(`/admin/orders/${completion.order.id}/cancel`, {}, { headers: admin, validateStatus: () => true })
      expect(cancel.status).toEqual(200)
      const res = await postNotice(paidNotice(sessionData, session))
      expect(res.data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(0)
      const order = await getContainer().resolve(Modules.ORDER).retrieveOrder(completion.order.id)
      expect(order.metadata?.ecpay_paid_after_cancel).toMatchObject({
        merchant_trade_no: sessionData.merchant_trade_no,
        amount: sessionData.amount,
      })
    })

    it("a paid order can be canceled; the refund is recorded as manual_pending for the back office", async () => {
      const { session, sessionData, completion } = await checkout()
      expect((await postNotice(paidNotice(sessionData, session))).data).toEqual("1|OK")
      const admin = await superAdminHeaders("refund@drn.test")
      const cancel = await api.post(`/admin/orders/${completion.order.id}/cancel`, {}, { headers: admin, validateStatus: () => true })
      expect(cancel.status).toEqual(200)
      const { data: payments } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "payment", fields: ["id", "data", "refunds.amount"], filters: { payment_session_id: session.id } })
      expect(payments[0].refunds?.map((r: any) => Number(r.amount))).toEqual([sessionData.amount])
      expect((payments[0].data as any).ecpay_manual_refunds).toEqual([
        expect.objectContaining({ amount: sessionData.amount, status: "manual_pending" }),
      ])
    })

    it("paid notice for a session that was replaced before checkout -> non-ACK so ECPay keeps retrying", async () => {
      const first = await checkout({ complete: false })
      // Replace the session (allowed while the cart is not completed): the first one is deleted.
      await api.post(
        `/store/payment-collections/${first.paymentCollectionId}/payment-sessions`,
        { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } },
        { headers: first.headers }
      )
      const res = await postNotice(paidNotice(first.sessionData, first.session))
      expect(res.status).toEqual(400)
      expect(res.data).not.toEqual("1|OK")
      expect(await capturedPayments(first.session.id)).toHaveLength(0)
    })
  },
})
