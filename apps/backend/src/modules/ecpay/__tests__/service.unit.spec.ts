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
  paymentInfoUrl: "https://api.example.com/hooks/ecpay/payment-info",
  acceptSimulatedPayments: false,
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

  it.each(["ATM", "CVS", "BARCODE"])("builds a %s form that reports the code to PaymentInfoURL", async (method) => {
    const out = await provider().initiatePayment({
      amount: 1150,
      currency_code: "twd",
      data: { session_id: "payses_1", choose_payment: method },
    })
    const fields = (out.data as any).checkout_form.fields
    expect(fields.ChoosePayment).toEqual(method)
    expect(fields.PaymentInfoURL).toEqual(options.paymentInfoUrl)
    expect(verifyCheckMacValue(fields, mac)).toBe(true)
  })

  it("refuses unknown payment methods", async () => {
    await expect(
      provider().initiatePayment({
        amount: 1150,
        currency_code: "twd",
        data: { session_id: "payses_1", choose_payment: "WebATM" },
      })
    ).rejects.toThrow()
  })
})

const signNotice = (fields: Record<string, string>) => ({
  ...fields,
  CheckMacValue: computeCheckMacValue(fields, mac),
})

const paidNoticeFor = (data: any, overrides: Record<string, string> = {}) =>
  signNotice({
    MerchantID: options.merchantId,
    MerchantTradeNo: data.merchant_trade_no,
    RtnCode: "1",
    TradeNo: "2610130105091234",
    TradeAmt: String(data.amount),
    PaymentType: "Credit_CreditCard",
    SimulatePaid: "0",
    CustomField1: data.session_id,
    ...overrides,
  })

const tradeInfoFor = (data: any, overrides: Record<string, string> = {}) =>
  signNotice({
    MerchantID: options.merchantId,
    MerchantTradeNo: data.merchant_trade_no,
    TradeNo: "2610130105091234",
    TradeAmt: String(data.amount),
    TradeStatus: "1",
    PaymentType: "Credit_CreditCard",
    ...overrides,
  })

describe("authorizePayment (proof of payment, no network)", () => {
  it("is captured with a verified notice bound to this session, without calling ECPay", async () => {
    const { data } = await initiate()
    const fetchSpy = jest.spyOn(globalThis, "fetch")
    const out = await provider().authorizePayment({ data: { ...data, ecpay_notice: paidNoticeFor(data) } })
    expect(out.status).toEqual(PaymentSessionStatus.CAPTURED)
    expect((out.data as any).ecpay_trade_no).toEqual("2610130105091234")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("is captured with a verified QueryTradeInfo answer (reconciliation path)", async () => {
    const { data } = await initiate()
    const out = await provider().authorizePayment({ data: { ...data, ecpay_trade_info: tradeInfoFor(data) } })
    expect(out.status).toEqual(PaymentSessionStatus.CAPTURED)
  })

  it("stays pending_authorization with no proof (cart completion before payment), without calling ECPay", async () => {
    const { data } = await initiate()
    const fetchSpy = jest.spyOn(globalThis, "fetch")
    expect((await provider().authorizePayment({ data })).status).toEqual(PaymentSessionStatus.PENDING_AUTHORIZATION)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ["another trade's notice", (d: any) => ({ ecpay_notice: paidNoticeFor(d, { MerchantTradeNo: "DNOTHERTRADE00000000" }) })],
    ["another session's notice", (d: any) => ({ ecpay_notice: paidNoticeFor(d, { CustomField1: "payses_other" }) })],
    ["a notice for a different amount", (d: any) => ({ ecpay_notice: paidNoticeFor(d, { TradeAmt: "1" }) })],
    ["a simulated notice", (d: any) => ({ ecpay_notice: paidNoticeFor(d, { SimulatePaid: "1" }) })],
    ["a failed notice", (d: any) => ({ ecpay_notice: paidNoticeFor(d, { RtnCode: "10100248" }) })],
    ["a tampered notice", (d: any) => ({ ecpay_notice: { ...paidNoticeFor(d), TradeAmt: "1" } })],
    ["an unpaid trade info", (d: any) => ({ ecpay_trade_info: tradeInfoFor(d, { TradeStatus: "0" }) })],
    ["plain 'paid' flags", () => ({ paid: true, status: "captured", ecpay_notice: { RtnCode: "1" } })],
  ])("is not captured with %s", async (_n, extra) => {
    const { data } = await initiate()
    const out = await provider().authorizePayment({ data: { ...data, ...extra(data) } })
    expect(out.status).toEqual(PaymentSessionStatus.PENDING_AUTHORIZATION)
  })

  it("drops unknown client keys from the stored session data", async () => {
    const { data } = await initiate()
    const out = await provider().authorizePayment({ data: { ...data, paid: true } })
    expect((out.data as any).paid).toBeUndefined()
  })
})

describe("updatePayment", () => {
  it("attaches a verified notice and keeps the trade number", async () => {
    const { data } = await initiate()
    const out = await provider().updatePayment({
      amount: 1150,
      currency_code: "twd",
      data: { ...data, ecpay_notice: paidNoticeFor(data) },
    })
    expect((out.data as any).merchant_trade_no).toEqual((data as any).merchant_trade_no)
    expect((out.data as any).ecpay_notice).toBeDefined()
  })

  it("refuses a notice that does not verify for this session", async () => {
    const { data } = await initiate()
    await expect(
      provider().updatePayment({
        amount: 1150,
        currency_code: "twd",
        data: { ...data, ecpay_notice: paidNoticeFor(data, { CustomField1: "payses_other" }) },
      })
    ).rejects.toThrow(/does not verify/)
  })

  it("refuses to re-price a paid trade", async () => {
    const { data } = await initiate()
    await expect(
      provider().updatePayment({
        amount: 2300,
        currency_code: "twd",
        data: { ...data, ecpay_notice: paidNoticeFor(data) },
      })
    ).rejects.toThrow(/re-priced/)
  })

  it("issues a new trade number and form when the amount changes before payment", async () => {
    const { data } = await initiate()
    const out = await provider().updatePayment({ amount: 2300, currency_code: "twd", data })
    expect((out.data as any).merchant_trade_no).not.toEqual((data as any).merchant_trade_no)
    expect((out.data as any).checkout_form.fields.TotalAmount).toEqual("2300")
  })
})

describe("payment codes (ATM / CVS / BARCODE)", () => {
  const atmInfoFor = (data: any, o: Record<string, string> = {}) =>
    signNotice({
      MerchantID: options.merchantId,
      MerchantTradeNo: data.merchant_trade_no,
      RtnCode: "2",
      TradeNo: "2610130105091234",
      TradeAmt: String(data.amount),
      PaymentType: "ATM_FIRST",
      BankCode: "007",
      vAccount: "9103522175887271",
      ExpireDate: "2026/10/16",
      CustomField1: data.session_id,
      ...o,
    })

  const atmSession = async () =>
    (
      await provider().initiatePayment({
        amount: 1150,
        currency_code: "twd",
        data: { session_id: "payses_1", choose_payment: "ATM" },
      })
    ).data as any

  it("stores verified payment instructions and keeps the trade", async () => {
    const data = await atmSession()
    const out = await provider().updatePayment({
      amount: 1150,
      currency_code: "twd",
      data: { ...data, ecpay_payment_info: atmInfoFor(data) },
    })
    expect((out.data as any).merchant_trade_no).toEqual(data.merchant_trade_no)
    expect((out.data as any).ecpay_payment_instructions).toEqual({
      payment_type: "ATM_FIRST",
      bank_code: "007",
      v_account: "9103522175887271",
      expire_date: "2026/10/16",
      expires_at: "2026-10-16T15:59:59.000Z",
    })
  })

  it("an issued code is not a payment", async () => {
    const data = await atmSession()
    const stored = (
      await provider().updatePayment({ amount: 1150, currency_code: "twd", data: { ...data, ecpay_payment_info: atmInfoFor(data) } })
    ).data
    expect((await provider().authorizePayment({ data: stored })).status).toEqual(
      PaymentSessionStatus.PENDING_AUTHORIZATION
    )
  })

  it("refuses a code notice that does not verify for this session", async () => {
    const data = await atmSession()
    await expect(
      provider().updatePayment({
        amount: 1150,
        currency_code: "twd",
        data: { ...data, ecpay_payment_info: atmInfoFor(data, { CustomField1: "payses_x" }) },
      })
    ).rejects.toThrow(/does not verify/)
  })

  it("simulated paid notices count only with acceptSimulatedPayments (stage)", async () => {
    const data = await atmSession()
    const simulated = { ...data, ecpay_notice: paidNoticeFor(data, { SimulatePaid: "1" }) }
    expect((await provider().authorizePayment({ data: simulated })).status).toEqual(
      PaymentSessionStatus.PENDING_AUTHORIZATION
    )
    const stage = new EcpayPaymentProviderService({ logger }, { ...options, acceptSimulatedPayments: true })
    expect((await stage.authorizePayment({ data: simulated })).status).toEqual(PaymentSessionStatus.CAPTURED)
  })

  it("validateOptions refuses simulated payments in prod", () => {
    expect(() =>
      EcpayPaymentProviderService.validateOptions({ ...options, environment: "prod", acceptSimulatedPayments: true } as any)
    ).toThrow()
  })
})

describe("getPaymentStatus (asks ECPay when there is no stored proof)", () => {
  it("reports captured from a signed paid QueryTradeInfo answer", async () => {
    const { data } = await initiate()
    const fetchSpy = respondWith(new URLSearchParams(tradeInfoFor(data)).toString())
    expect((await provider().getPaymentStatus({ data })).status).toEqual(PaymentSessionStatus.CAPTURED)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toEqual(options.queryTradeInfoUrl)
    expect(verifyCheckMacValue(Object.fromEntries(new URLSearchParams(String(init.body))), mac)).toBe(true)
  })

  it("does not trust unsigned answers or network errors", async () => {
    const { data } = await initiate()
    respondWith("TradeStatus=1&TradeAmt=1150")
    expect((await provider().getPaymentStatus({ data })).status).toEqual(PaymentSessionStatus.PENDING_AUTHORIZATION)
    jest.restoreAllMocks()
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"))
    expect((await provider().getPaymentStatus({ data })).status).toEqual(PaymentSessionStatus.PENDING_AUTHORIZATION)
  })

  it("is an error when ECPay reports paid for a different amount", async () => {
    const { data } = await initiate()
    respondWith(new URLSearchParams(tradeInfoFor(data, { TradeAmt: "1" })).toString())
    expect((await provider().getPaymentStatus({ data })).status).toEqual(PaymentSessionStatus.ERROR)
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
  it("records a manual pending refund and raises an alert until DoAction is automated (P4-08)", async () => {
    logger.error.mockClear()
    const out = await provider().refundPayment({ amount: 1150, data: { merchant_trade_no: "DN1", ecpay_trade_no: "T1" } })
    expect((out.data as any).ecpay_manual_refunds).toEqual([
      expect.objectContaining({ amount: 1150, status: "manual_pending" }),
    ])
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("[ECPAY-ALERT] manual refund required"))
  })

  it("appends to earlier manual refunds and rejects non-integer amounts", async () => {
    const first = await provider().refundPayment({ amount: 100, data: {} })
    const second = await provider().refundPayment({ amount: 200, data: first.data })
    expect((second.data as any).ecpay_manual_refunds).toHaveLength(2)
    await expect(provider().refundPayment({ amount: 1.5, data: {} })).rejects.toThrow()
  })
})
