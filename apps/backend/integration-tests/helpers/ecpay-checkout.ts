// Shared helpers for the ECPay integration specs (store checkout, signed notices, seeds).
import { readdirSync } from "fs"
import { join } from "path"
import type { IRbacModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, generateJwtToken } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { computeCheckMacValue } from "../../src/lib/ecpay/check-mac-value"
import { ECPAY_PROVIDER_ID } from "../../src/lib/ecpay/config"
import catalog from "../../src/data/catalog.json"
import { FULFILLMENT_SET_NAME, PUBLISHABLE_KEYS, STOCK_LOCATION_NAME } from "../../src/lib/drn-setup"

export const MAC = {
  hashKey: process.env.ECPAY_HASH_KEY as string,
  hashIV: process.env.ECPAY_HASH_IV as string,
  algorithm: "sha256" as const,
}
export const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID as string

export const MIGRATION_DIR = join(__dirname, "../../src/migration-scripts")
export const runAllSeeds = async (container: MedusaContainer) => {
  const files = readdirSync(MIGRATION_DIR)
    .filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith(".d.ts"))
    .sort((a, b) => a.localeCompare(b))
  for (const f of files) {
    await (await import(join(MIGRATION_DIR, f))).default({ container })
  }
}

// Test-only home delivery option; ECPay logistics replaces this in P4-05.
export const addTestShipping = async (container: MedusaContainer) => {
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

export const signedNotice = (overrides: Record<string, string>) => {
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


type Api = { get: (...a: any[]) => Promise<any>; post: (...a: any[]) => Promise<any> }

export function makeCheckoutHelpers({ api, getContainer }: { api: Api; getContainer: () => MedusaContainer }) {
  const storeHeaders = async () => {
    const [key] = await getContainer()
      .resolve(Modules.API_KEY)
      .listApiKeys({ title: PUBLISHABLE_KEYS.official, type: "publishable" })
    return { "x-publishable-api-key": key.token }
  }

  // Admin user with one RBAC role (default Super Admin; also "operations", "support", ...).
  const superAdminHeaders = async (email: string, roleName = "Super Admin") => {
    const container = getContainer()
    const user = await container.resolve(Modules.USER).createUsers({ email })
    const identity = await container.resolve(Modules.AUTH).createAuthIdentities({
      provider_identities: [{ provider: "emailpass", entity_id: email }],
      app_metadata: { user_id: user.id },
    })
    const [role] = await container.resolve<IRbacModuleService>(Modules.RBAC).listRbacRoles({ name: roleName })
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

  // E-mail verification codes (P5-01 review auth-2): Medusa emits them only on the event bus
  // (auth.verification_requested); tests read them there. One subscription per app container.
  const verificationCodes = new Map<string, string>()
  let subscribedTo: MedusaContainer | null = null
  const ensureCodeSubscription = () => {
    const container = getContainer()
    if (subscribedTo === container) return
    container.resolve(Modules.EVENT_BUS).subscribe("auth.verification_requested", async ({ data }: any) => {
      if (data?.code) verificationCodes.set(String(data.entity_id), String(data.code))
    })
    subscribedTo = container
  }
  const verificationCodeFor = async (email: string) => {
    for (let i = 0; i < 50; i++) {
      const code = verificationCodes.get(email)
      if (code) return code
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`no verification code for ${email}`)
  }
  // Request + confirm an e-mail verification for the identity behind `token`.
  const verifyEmail = async (token: string, email: string) => {
    ensureCodeSubscription()
    const normalized = email.trim().toLowerCase()
    verificationCodes.delete(normalized)
    const auth = { authorization: `Bearer ${token}` }
    const req = await api.post("/auth/verification/request", { entity_id: email, entity_type: "email" }, { headers: auth, validateStatus: () => true })
    if (req.status >= 300) throw new Error(`verification request ${req.status}: ${JSON.stringify(req.data)}`)
    const code = await verificationCodeFor(normalized)
    const conf = await api.post("/auth/verification/confirm", { code }, { headers: auth, validateStatus: () => true })
    if (conf.status >= 300) throw new Error(`verification confirm ${conf.status}: ${JSON.stringify(conf.data)}`)
    return code
  }

  // Registered member (emailpass, e-mail verified): store headers with the member's bearer token.
  const registerCustomer = async (email: string) => {
    const password = "drn-test-only-Pw1" // local test account, never a real credential
    const store = await storeHeaders()
    const { data: reg } = await api.post("/auth/customer/emailpass/register", { email, password })
    await verifyEmail(reg.token, email)
    await api.post("/store/customers", { email, first_name: "測試", last_name: "會員" }, { headers: { ...store, authorization: `Bearer ${reg.token}` } })
    const { data: login } = await api.post("/auth/customer/emailpass", { email, password })
    const headers = { ...store, authorization: `Bearer ${login.token}` }
    const { data: me } = await api.get("/store/customers/me", { headers })
    return { headers, customerId: me.customer.id as string }
  }

  // Store checkout up to an order awaiting payment (or stop before completing the cart).
  const checkout = async ({
    complete = true,
    choosePayment = "Credit",
  }: { complete?: boolean; choosePayment?: string } = {}) => {
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
    const testOption = so.shipping_options.find((o: any) => o.name === "Test home delivery") ?? so.shipping_options[0]
    await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: testOption.id }, { headers })
    const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, { headers })
    const { data: ps } = await api.post(
      `/store/payment-collections/${pc.payment_collection.id}/payment-sessions`,
      { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: choosePayment } },
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

  const postPaymentInfo = (body: Record<string, string>) =>
    api.post("/hooks/ecpay/payment-info", new URLSearchParams(body).toString(), {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      validateStatus: () => true,
    })

  const CODE_FIELDS: Record<"ATM" | "CVS" | "BARCODE", Record<string, string>> = {
    ATM: { RtnCode: "2", RtnMsg: "Get VirtualAccount Succeeded", PaymentType: "ATM_FIRST", BankCode: "007", vAccount: "9103522175887271", ExpireDate: "2026/10/16" },
    CVS: { RtnCode: "10100073", RtnMsg: "Get CVS Code Succeeded.", PaymentType: "CVS_CVS", PaymentNo: "LLL22251222", ExpireDate: "2026/10/20 01:05:09" },
    BARCODE: {
      RtnCode: "10100073",
      RtnMsg: "Get Barcode Succeeded.",
      PaymentType: "BARCODE_BARCODE",
      Barcode1: "1510207AA",
      Barcode2: "0000000000000000",
      Barcode3: "102000000001150",
      ExpireDate: "2026/10/20 01:05:09",
    },
  }
  const codeIssuedNotice = (sessionData: any, session: any, method: "ATM" | "CVS" | "BARCODE", extra: Record<string, string> = {}) => {
    const fields: Record<string, string> = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: sessionData.merchant_trade_no,
      TradeNo: "2610130105091234",
      TradeAmt: String(sessionData.amount),
      TradeDate: "2026/10/13 01:05:09",
      CustomField1: session.id,
      ...CODE_FIELDS[method],
      ...extra,
    }
    return { ...fields, CheckMacValue: computeCheckMacValue(fields, MAC) }
  }

  const sessionData = async (sessionId: string) => {
    const [s] = await getContainer().resolve(Modules.PAYMENT).listPaymentSessions({ id: [sessionId] })
    return s?.data as any
  }

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


  return {
    storeHeaders,
    superAdminHeaders,
    registerCustomer,
    verifyEmail,
    verificationCodeFor,
    ensureCodeSubscription,
    checkout,
    postNotice,
    postPaymentInfo,
    codeIssuedNotice,
    sessionData,
    capturedPayments,
    paidNotice,
  }
}
