import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import EcpayPaymentProviderService from "../service"
import { computeCheckMacValue, verifyCheckMacValue } from "../../../lib/ecpay/check-mac-value"
import type { EcpayProviderOptions } from "../../../lib/ecpay/config"

// ECPay PUBLIC sandbox merchant (developers.ecpay.com.tw/2856/).
const options: EcpayProviderOptions = {
  environment: "stage",
  merchantId: "3002607",
  hashKey: "pwFHCqoQZGmho4w6",
  hashIV: "EkRm7iFT261dpevs",
  returnUrl: "https://api.example.com/hooks/ecpay/payment",
  orderResultUrl: "https://shop.example.com/checkout/ecpay/result",
  clientBackUrl: "https://shop.example.com/account/orders",
  checkoutUrl: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
  queryTradeInfoUrl: "http://stub.invalid/Cashier/QueryTradeInfo/V5",
}
const mac = { hashKey: options.hashKey, hashIV: options.hashIV, algorithm: "sha256" as const }
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any
const provider = () => new EcpayPaymentProviderService({ logger }, options)

const signedBody = (fields: Record<string, string>) =>
  new URLSearchParams({ ...fields, CheckMacValue: computeCheckMacValue(fields, mac) }).toString()

const respondWith = (body: string, status = 200) =>
  jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status }))

afterEach(() => jest.restoreAllMocks())

const initiate = () =>
  provider().initiatePayment({
    amount: 1150,
    currency_code: "twd",
    data: { session_id: "payses_1", choose_payment: "Credit" },
  })

describe("validateOptions", () => {
  it("requires every option", () => {
    expect(() => EcpayPaymentProviderService.validateOptions({ ...options, hashKey: "" })).toThrow()
    expect(() => EcpayPaymentProviderService.validateOptions(undefined as any)).toThrow()
    expect(() => EcpayPaymentProviderService.validateOptions(options as any)).not.toThrow()
  })
  it("requires an HTTPS ReturnURL in prod", () => {
    expect(() =>
      EcpayPaymentProviderService.validateOptions({ ...options, environment: "prod", returnUrl: "http://x" } as any)
    ).toThrow()
  })
})

describe("initiatePayment", () => {
  it("returns a signed form bound to the session, without keys", async () => {
    const out = await initiate()
    const data = out.data as any
    expect(out.id).toEqual(data.merchant_trade_no)
    expect(out.status).toEqual(PaymentSessionStatus.PENDING)
    expect(data.amount).toEqual(1150)
    expect(data.checkout_form.action).toEqual(options.checkoutUrl)
    expect(data.checkout_form.fields.CustomField1).toEqual("payses_1")
    expect(data.checkout_form.fields.MerchantTradeNo).toEqual(data.merchant_trade_no)
    expect(verifyCheckMacValue(data.checkout_form.fields, mac)).toBe(true)
    expect(JSON.stringify(out)).not.toContain(options.hashKey)
  })

  it.each([
    ["non-integer amount", { amount: 1150.5, currency_code: "twd" }],
    ["non-TWD currency", { amount: 1150, currency_code: "usd" }],
    ["zero amount", { amount: 0, currency_code: "twd" }],
  ])("refuses %s", async (_n, v) => {
    await expect(
      provider().initiatePayment({ ...v, data: { session_id: "payses_1" } } as any)
    ).rejects.toThrow()
  })

  it("refuses payment methods not enabled yet (ATM/CVS come in P4-04)", async () => {
    await expect(
      provider().initiatePayment({
        amount: 1150,
        currency_code: "twd",
        data: { session_id: "payses_1", choose_payment: "ATM" },
      })
    ).rejects.toThrow()
  })
})

describe("authorizePayment", () => {
  const trade = (data: any, overrides: Record<string, string> = {}) =>
    signedBody({
      MerchantID: options.merchantId,
      MerchantTradeNo: data.merchant_trade_no,
      TradeNo: "2610130105091234",
      TradeAmt: "1150",
      TradeStatus: "1",
      PaymentType: "Credit_CreditCard",
      ...overrides,
    })

  it("is captured only when ECPay's signed answer says paid for the right amount", async () => {
    const { data } = await initiate()
    const fetchSpy = respondWith(trade(data))
    const out = await provider().authorizePayment({ data })
    expect(out.status).toEqual(PaymentSessionStatus.CAPTURED)
    expect((out.data as any).ecpay_trade_no).toEqual("2610130105091234")
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toEqual(options.queryTradeInfoUrl)
    const sent = Object.fromEntries(new URLSearchParams(String(init.body)))
    expect(verifyCheckMacValue(sent, mac)).toBe(true)
  })

  it.each([
    ["unpaid (TradeStatus 0)", { TradeStatus: "0" }],
    ["failed (TradeStatus 10200095)", { TradeStatus: "10200095" }],
  ])("stays pending_authorization when %s", async (_n, o) => {
    const { data } = await initiate()
    respondWith(trade(data, o))
    expect((await provider().authorizePayment({ data })).status).toEqual(
      PaymentSessionStatus.PENDING_AUTHORIZATION
    )
  })

  it("is an error when paid for a different amount", async () => {
    const { data } = await initiate()
    respondWith(trade(data, { TradeAmt: "1" }))
    expect((await provider().authorizePayment({ data })).status).toEqual(PaymentSessionStatus.ERROR)
  })

  it("does not trust an unsigned 'paid' answer, another trade's answer, or a network error", async () => {
    const { data } = await initiate()
    respondWith("TradeStatus=1&TradeAmt=1150")
    expect((await provider().authorizePayment({ data })).status).toEqual(
      PaymentSessionStatus.PENDING_AUTHORIZATION
    )
    jest.restoreAllMocks()
    respondWith(trade({ merchant_trade_no: "DNOTHERTRADE00000000" }))
    expect((await provider().authorizePayment({ data })).status).toEqual(
      PaymentSessionStatus.PENDING_AUTHORIZATION
    )
    jest.restoreAllMocks()
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"))
    expect((await provider().authorizePayment({ data })).status).toEqual(
      PaymentSessionStatus.PENDING_AUTHORIZATION
    )
  })

  it("ignores a 'paid' flag injected into session data by the storefront", async () => {
    const { data } = await initiate()
    respondWith(trade(data, { TradeStatus: "0" }))
    const out = await provider().authorizePayment({ data: { ...data, paid: true, status: "captured" } })
    expect(out.status).toEqual(PaymentSessionStatus.PENDING_AUTHORIZATION)
  })
})

describe("getWebhookActionAndData", () => {
  const notice = (overrides: Record<string, string> = {}) => {
    const fields = {
      MerchantID: options.merchantId,
      MerchantTradeNo: "DN2610130105090123AB",
      RtnCode: "1",
      TradeNo: "2610130105091234",
      TradeAmt: "1150",
      SimulatePaid: "0",
      CustomField1: "payses_1",
      ...overrides,
    }
    return { ...fields, CheckMacValue: computeCheckMacValue(fields, mac) }
  }

  it("maps a paid notice to captured for its session", async () => {
    const r = await provider().getWebhookActionAndData({ data: notice(), rawData: "", headers: {} })
    expect(r.action).toEqual(PaymentActions.SUCCESSFUL)
    expect(r.data?.session_id).toEqual("payses_1")
  })

  it.each([
    ["simulated", { SimulatePaid: "1" }, PaymentActions.NOT_SUPPORTED],
    ["failed", { RtnCode: "10100248" }, PaymentActions.FAILED],
  ])("maps a %s notice to %s", async (_n, o, action) => {
    const r = await provider().getWebhookActionAndData({ data: notice(o), rawData: "", headers: {} })
    expect(r.action).toEqual(action)
  })

  it("maps a tampered notice to failed with no session", async () => {
    const r = await provider().getWebhookActionAndData({
      data: { ...notice(), TradeAmt: "1" },
      rawData: "",
      headers: {},
    })
    expect(r.action).toEqual(PaymentActions.FAILED)
    expect(r.data?.session_id).toEqual("")
  })
})

describe("refundPayment", () => {
  it("refuses until DoAction refunds are implemented (P4-08)", async () => {
    await expect(provider().refundPayment({ amount: 1150, data: {} })).rejects.toThrow(/vendor back office/)
  })
})
