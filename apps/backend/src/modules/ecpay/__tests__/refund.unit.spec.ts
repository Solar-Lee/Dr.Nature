import EcpayPaymentProviderService from "../service"
import { verifyCheckMacValue } from "../../../lib/ecpay/check-mac-value"
import type { EcpayProviderOptions } from "../../../lib/ecpay/config"
import { buildCheckoutForm } from "../../../lib/ecpay/aio"
import {
  buildDoActionRequest,
  buildQueryCreditTradeRequest,
  inAutoCloseWindow,
  parseDoActionResponse,
  parseQueryCreditTrade,
  planCreditRefund,
} from "../../../lib/ecpay/credit-refund"

// ECPay PUBLIC sandbox merchant (developers.ecpay.com.tw/2856/). The CreditDetail APIs are
// production-only, so every answer below is a stub shaped like the docs (/2885/, /2894/).
const creds = { merchantId: "3002607", hashKey: "pwFHCqoQZGmho4w6", hashIV: "EkRm7iFT261dpevs" }
const mac = { hashKey: creds.hashKey, hashIV: creds.hashIV, algorithm: "sha256" as const }

describe("refund decision table (developers.ecpay.com.tw/2883/)", () => {
  const p = (refund: number, installmentOrBonus = false) => ({ authorised: 2300, refund, installmentOrBonus })
  it.each([
    ["authorised, full", { status: "已授權" }, p(2300), ["N:2300"]],
    ["authorised, partial", { status: "已授權" }, p(1150), ["C:2300", "R:1150"]],
    ["closing, full", { status: "已授權", lastClose: { status: "要關帳", amount: 2300 } }, p(2300), ["E:2300", "N:2300"]],
    ["closing, partial", { status: "已授權", lastClose: { status: "要關帳", amount: 2300 } }, p(1150), ["R:1150"]],
    ["closed", { status: "已關帳", lastClose: { status: "已關帳", amount: 2300 } }, p(1150), ["R:1150"]],
    ["operation canceled, full", { status: "已關帳", lastClose: { status: "操作取消", amount: 2300 } }, p(2300), ["N:2300"]],
  ])("%s", (_n, trade, params, steps) => {
    const plan = planCreditRefund(trade as any, params)
    expect(plan.ok && plan.steps.map((s) => `${s.action}:${s.amount}`)).toEqual(steps)
  })

  it.each([
    ["more than authorised", { status: "已授權" }, p(2301)],
    ["zero", { status: "已授權" }, p(0)],
    ["partial on an installment / bonus trade", { status: "已授權" }, p(1150, true)],
    ["an unknown state", { status: "未授權" }, p(2300)],
    ["a canceled trade", { status: "已取消" }, p(2300)],
  ])("refuses %s (goes to a human)", (_n, trade, params) => {
    expect(planCreditRefund(trade as any, params).ok).toBe(false)
  })

  it("uses the LAST close record with a positive amount", () => {
    expect(parseQueryCreditTrade({ RtnMsg: "", RtnValue: { status: "已關帳", close_data: [{ status: "要關帳", amount: 2300 }, { status: "已關帳", amount: 2300 }, { status: "操作取消", amount: 0 }] } })).toEqual({
      status: "已關帳",
      lastClose: { status: "已關帳", amount: 2300 },
    })
    expect(parseQueryCreditTrade({ RtnMsg: "error_nopay", RtnValue: {} })).toBeNull()
  })
})

describe("signed requests", () => {
  it("QueryTrade/V2 and DoAction are SHA256-signed with the documented fields", () => {
    const q = buildQueryCreditTradeRequest(creds, { gwsr: "11935017", amount: 2300, checkCode: "59997889" })
    expect(q).toMatchObject({ MerchantID: "3002607", CreditRefundId: "11935017", CreditAmount: "2300", CreditCheckCode: "59997889" })
    expect(verifyCheckMacValue(q, mac)).toBe(true)
    const d = buildDoActionRequest(creds, { merchantTradeNo: "DN261013010509ABCDEF", tradeNo: "2610130105091234", action: "R", amount: 1150 })
    expect(d).toMatchObject({ Action: "R", TotalAmount: "1150", TradeNo: "2610130105091234" })
    expect(verifyCheckMacValue(d, mac)).toBe(true)
  })

  it("DoAction success needs RtnCode 1 for our merchant and trade", () => {
    const e = { merchantId: "3002607", merchantTradeNo: "DN1" }
    expect(parseDoActionResponse("MerchantID=3002607&MerchantTradeNo=DN1&TradeNo=1&RtnCode=1&RtnMsg=OK", e).ok).toBe(true)
    expect(parseDoActionResponse("MerchantID=3002607&MerchantTradeNo=DN1&TradeNo=1&RtnCode=10100059&RtnMsg=x", e).ok).toBe(false)
    expect(parseDoActionResponse("MerchantID=9999999&MerchantTradeNo=DN1&TradeNo=1&RtnCode=1", e).ok).toBe(false)
  })

  it("auto-close window is 20:15-20:30 Taipei", () => {
    expect(inAutoCloseWindow(new Date("2026-10-13T20:20:00+08:00"))).toBe(true)
    expect(inAutoCloseWindow(new Date("2026-10-13T20:30:00+08:00"))).toBe(false)
    expect(inAutoCloseWindow(new Date("2026-10-13T20:14:59+08:00"))).toBe(false)
  })

  it("NeedExtraPaidInfo=Y only for credit and only when asked", () => {
    const base = { credentials: creds, environment: "stage" as const, merchantTradeNo: "DN1", tradeDate: new Date(), totalAmount: 1150, itemName: "x", tradeDesc: "x", returnUrl: "https://a.b/c", customField1: "s", paymentInfoUrl: "https://a.b/d" }
    expect(buildCheckoutForm({ ...base, choosePayment: "Credit", needExtraPaidInfo: true }).fields.NeedExtraPaidInfo).toEqual("Y")
    expect(buildCheckoutForm({ ...base, choosePayment: "Credit" }).fields.NeedExtraPaidInfo).toBeUndefined()
    expect(buildCheckoutForm({ ...base, choosePayment: "ATM", needExtraPaidInfo: true }).fields.NeedExtraPaidInfo).toBeUndefined()
  })
})

describe("provider refundPayment", () => {
  const options = {
    environment: "prod",
    ...creds,
    returnUrl: "https://api.example.com/hooks/ecpay/payment",
    orderResultUrl: "",
    clientBackUrl: "",
    checkoutUrl: "",
    queryTradeInfoUrl: "http://stub.invalid/q",
    tradeNoAioUrl: "http://stub.invalid/t",
    paymentInfoUrl: "https://api.example.com/hooks/ecpay/payment-info",
    acceptSimulatedPayments: false,
    autoRefund: true,
    creditCheckCode: "59997889",
    doActionUrl: "http://stub.invalid/CreditDetail/DoAction",
    queryCreditTradeUrl: "http://stub.invalid/CreditDetail/QueryTrade/V2",
  } as EcpayProviderOptions
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any
  const paid = {
    merchant_trade_no: "DN1",
    ecpay_trade_no: "2610130105091234",
    ecpay_payment_type: "Credit_CreditCard",
    ecpay_gwsr: "11935017",
    ecpay_installment_or_bonus: false,
    amount: 2300,
  }
  const answers = (queryJson: unknown, doActions: string[]) => {
    const calls: { url: string; body: Record<string, string> }[] = []
    jest.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      const body = Object.fromEntries(new URLSearchParams(String(init.body)))
      calls.push({ url: String(url), body })
      if (String(url).includes("QueryTrade")) return new Response(JSON.stringify(queryJson))
      return new Response(doActions.shift() ?? "")
    })
    return calls
  }
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.useFakeTimers({ now: new Date("2026-10-13T10:00:00+08:00"), doNotFake: ["nextTick", "setImmediate"] })
    logger.error.mockClear()
  })
  afterEach(() => jest.useRealTimers())

  it("full refund of an authorised trade = one N, recorded as refunded", async () => {
    const calls = answers({ RtnMsg: "", RtnValue: { status: "已授權", close_data: [] } }, ["MerchantID=3002607&MerchantTradeNo=DN1&TradeNo=2610130105091234&RtnCode=1&RtnMsg=OK"])
    const out = await new EcpayPaymentProviderService({ logger }, options).refundPayment({ amount: 2300, data: paid } as any)
    expect(calls.map((c) => c.body.Action ?? "query")).toEqual(["query", "N"])
    expect((out.data as any).ecpay_refunds).toEqual([expect.objectContaining({ amount: 2300, status: "refunded" })])
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("a DoAction failure falls back to a manual refund with an alert", async () => {
    answers({ RtnMsg: "", RtnValue: { status: "已關帳", close_data: [{ status: "已關帳", amount: 2300 }] } }, ["MerchantID=3002607&MerchantTradeNo=DN1&RtnCode=10100148&RtnMsg=x"])
    const out = await new EcpayPaymentProviderService({ logger }, options).refundPayment({ amount: 1150, data: paid } as any)
    expect((out.data as any).ecpay_manual_refunds).toEqual([expect.objectContaining({ amount: 1150, status: "manual_pending", reason: expect.stringContaining("DoAction R failed") })])
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("[ECPAY-ALERT] manual refund required"))
  })

  it("a partial C+R that fails at R says C already succeeded", async () => {
    answers({ RtnMsg: "", RtnValue: { status: "已授權", close_data: [] } }, ["MerchantID=3002607&MerchantTradeNo=DN1&RtnCode=1", "MerchantID=3002607&MerchantTradeNo=DN1&RtnCode=0&RtnMsg=x"])
    const out = await new EcpayPaymentProviderService({ logger }, options).refundPayment({ amount: 1150, data: paid } as any)
    expect((out.data as any).ecpay_manual_refunds[0].reason).toContain("after C succeeded")
  })

  it.each([
    ["automatic refunds off", { ...options, autoRefund: false }, paid],
    ["an ATM payment (no refund API)", options, { ...paid, ecpay_payment_type: "ATM_LAND" }],
    ["no gwsr (paid before NeedExtraPaidInfo / recovered by query)", options, { ...paid, ecpay_gwsr: undefined }],
  ])("%s -> manual, ECPay never called", async (_n, opts, data) => {
    const spy = jest.spyOn(globalThis, "fetch")
    const out = await new EcpayPaymentProviderService({ logger }, opts as EcpayProviderOptions).refundPayment({ amount: 1150, data } as any)
    expect(spy).not.toHaveBeenCalled()
    expect((out.data as any).ecpay_manual_refunds[0].status).toEqual("manual_pending")
  })

  it("inside the auto-close window -> manual", async () => {
    jest.setSystemTime(new Date("2026-10-13T20:20:00+08:00"))
    const spy = jest.spyOn(globalThis, "fetch")
    const out = await new EcpayPaymentProviderService({ logger }, options).refundPayment({ amount: 2300, data: paid } as any)
    expect(spy).not.toHaveBeenCalled()
    expect((out.data as any).ecpay_manual_refunds[0].reason).toContain("auto-close")
  })
})

describe("authorize keeps gwsr only from a verified NeedExtraPaidInfo notice", () => {
  const { computeCheckMacValue } = require("../../../lib/ecpay/check-mac-value")
  const options = {
    environment: "stage", ...creds, returnUrl: "https://a/b", orderResultUrl: "", clientBackUrl: "", checkoutUrl: "",
    queryTradeInfoUrl: "http://stub.invalid/q", tradeNoAioUrl: "http://stub.invalid/t", paymentInfoUrl: "https://a/c",
    acceptSimulatedPayments: false, autoRefund: true, creditCheckCode: "1", doActionUrl: "x", queryCreditTradeUrl: "y",
  } as EcpayProviderOptions
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any
  const notice = (extra: Record<string, string>) => {
    const f = {
      MerchantID: creds.merchantId, MerchantTradeNo: "DN261013010509ABCDEF", RtnCode: "1", RtnMsg: "交易成功", TradeNo: "2610130105091234",
      TradeAmt: "2300", PaymentType: "Credit_CreditCard", PaymentDate: "2026/10/13 01:06:00", TradeDate: "2026/10/13 01:05:09",
      SimulatePaid: "0", CustomField1: "payses_1", ...extra,
    }
    return { ...f, CheckMacValue: computeCheckMacValue(f, mac) }
  }
  const session = (n: Record<string, string>) => ({
    session_id: "payses_1", merchant_trade_no: "DN261013010509ABCDEF", amount: 2300, currency_code: "twd", choose_payment: "Credit", ecpay_notice: n,
  })

  it("stores gwsr and the installment flag from the signed notice", async () => {
    const out = await new EcpayPaymentProviderService({ logger }, options).authorizePayment({ data: session(notice({ gwsr: "11935017", stage: "3", red_dan: "0", card4no: "2222" })) } as any)
    expect(out.data).toMatchObject({ ecpay_gwsr: "11935017", ecpay_installment_or_bonus: true })
  })

  it("a tampered gwsr breaks the signature, so nothing is stored", async () => {
    const n = { ...notice({ gwsr: "11935017" }), gwsr: "99999999" }
    const out = await new EcpayPaymentProviderService({ logger }, options).authorizePayment({ data: session(n) } as any)
    expect((out.data as any).ecpay_gwsr).toBeUndefined()
  })
})
