// P4-09 deadlines (lib/ecpay/unpaid.ts): when an unpaid trade is final and when its order may
// be canceled. Pure functions; the integration spec (ecpay-unpaid.spec.ts) drives them through
// the cancel job and re-pay. Cannot prove: ECPay's real credit-page lifetime or barcode lag.
import {
  anchorOf,
  cancelAfter,
  ecpayTradesNewestFirst,
  hasProof,
  isOnlineTrade,
  liveOfflineCode,
  taipeiInstant,
  tradeCreatedAt,
  tradeFinalAt,
} from "../unpaid"

const MIN = 60 * 1000
const DAY = 24 * 60 * MIN
const at = (iso: string) => new Date(iso)
const session = (createdAt: string, merchantTradeDate?: string) => ({
  created_at: createdAt,
  data: merchantTradeDate ? { checkout_form: { fields: { MerchantTradeDate: merchantTradeDate } } } : {},
})
const code = (paymentType: string, expiresAt: string) => ({ ecpay_payment_instructions: { payment_type: paymentType, expires_at: expiresAt } })

describe("taipeiInstant", () => {
  it("reads ECPay's '/' form and the CSV '-' form as Taipei time (UTC+8)", () => {
    expect(taipeiInstant("2026/10/13 08:00:00")?.toISOString()).toEqual("2026-10-13T00:00:00.000Z")
    expect(taipeiInstant("2026-10-13 08:00:00")?.toISOString()).toEqual("2026-10-13T00:00:00.000Z")
    expect(taipeiInstant(" 2026/01/01 00:30:05 ")?.toISOString()).toEqual("2025-12-31T16:30:05.000Z")
  })

  it("returns null for anything else", () => {
    for (const bad of ["", "2026/10/13", "2026/10/13T08:00:00", "13/10/2026 08:00:00", "garbage", null, undefined, 42]) {
      expect(taipeiInstant(bad)).toBeNull()
    }
  })
})

describe("tradeCreatedAt / anchorOf", () => {
  it("the signed MerchantTradeDate wins over the session row's created_at", () => {
    expect(tradeCreatedAt(session("2026-10-13T00:00:00.000Z", "2026/10/13 09:30:00")).toISOString()).toEqual("2026-10-13T01:30:00.000Z")
  })

  it("falls back to created_at without a parsable MerchantTradeDate", () => {
    expect(tradeCreatedAt(session("2026-10-13T00:00:00.000Z")).toISOString()).toEqual("2026-10-13T00:00:00.000Z")
    expect(tradeCreatedAt(session("2026-10-13T00:00:00.000Z", "not a date")).toISOString()).toEqual("2026-10-13T00:00:00.000Z")
  })

  it("the anchor is the later of order placed and trade created", () => {
    const orderAt = at("2026-10-13T00:00:00.000Z")
    // checkout session created before the order: the order wins
    expect(anchorOf(orderAt, session("2026-10-12T23:59:00.000Z", "2026/10/13 07:59:00")).toISOString()).toEqual("2026-10-13T00:00:00.000Z")
    // re-pay trade created later: the trade wins
    expect(anchorOf(orderAt, session("2026-10-13T02:50:00.000Z", "2026/10/13 10:50:00")).toISOString()).toEqual("2026-10-13T02:50:00.000Z")
  })
})

describe("tradeFinalAt", () => {
  const anchor = at("2026-10-13T00:00:00.000Z")

  it("Credit and ApplePay: 40 minutes after the anchor", () => {
    expect(tradeFinalAt({ choose_payment: "Credit" }, anchor).getTime()).toEqual(anchor.getTime() + 40 * MIN)
    expect(tradeFinalAt({ choose_payment: "ApplePay" }, anchor).getTime()).toEqual(anchor.getTime() + 40 * MIN)
  })

  it("ATM and CVS codes: their deadline + 1 day", () => {
    expect(tradeFinalAt({ choose_payment: "ATM", ...code("ATM_FIRST", "2026-10-16T15:59:59.000Z") }, anchor).toISOString()).toEqual("2026-10-17T15:59:59.000Z")
    expect(tradeFinalAt({ choose_payment: "CVS", ...code("CVS_CVS", "2026-10-19T17:05:09.000Z") }, anchor).toISOString()).toEqual("2026-10-20T17:05:09.000Z")
  })

  it("barcodes: their deadline + 7 days (status lags 1-5 business days)", () => {
    expect(tradeFinalAt({ choose_payment: "BARCODE", ...code("BARCODE_BARCODE", "2026-10-19T17:05:09.000Z") }, anchor).toISOString()).toEqual("2026-10-26T17:05:09.000Z")
  })

  it("offline method without a code: 24 hours after the anchor", () => {
    for (const m of ["ATM", "CVS", "BARCODE"]) {
      expect(tradeFinalAt({ choose_payment: m }, anchor).getTime()).toEqual(anchor.getTime() + DAY)
    }
  })
})

describe("cancelAfter", () => {
  const anchor = at("2026-10-13T00:00:00.000Z")

  it("online: the later of final and anchor + the credit window", () => {
    expect(cancelAfter({ choose_payment: "Credit" }, anchor, 180).getTime()).toEqual(anchor.getTime() + 180 * MIN)
    expect(cancelAfter({ choose_payment: "Credit" }, anchor, 60).getTime()).toEqual(anchor.getTime() + 60 * MIN)
  })

  it("regression: ApplePay follows the online rule, no longer the 24-hour offline rule", () => {
    expect(isOnlineTrade({ choose_payment: "ApplePay" })).toBe(true)
    expect(cancelAfter({ choose_payment: "ApplePay" }, anchor, 180).getTime()).toEqual(anchor.getTime() + 180 * MIN)
  })

  it("offline: exactly when the trade is final", () => {
    const atm = { choose_payment: "ATM", ...code("ATM_FIRST", "2026-10-16T15:59:59.000Z") }
    expect(cancelAfter(atm, anchor, 180)).toEqual(tradeFinalAt(atm, anchor))
    expect(cancelAfter({ choose_payment: "CVS" }, anchor, 180).getTime()).toEqual(anchor.getTime() + DAY)
  })
})

describe("helpers", () => {
  it("liveOfflineCode: true until the code's deadline, inclusive", () => {
    const d = code("ATM_FIRST", "2026-10-16T15:59:59.000Z")
    expect(liveOfflineCode(d, at("2026-10-16T15:59:59.000Z"))).toBe(true)
    expect(liveOfflineCode(d, at("2026-10-16T16:00:00.000Z"))).toBe(false)
    expect(liveOfflineCode({ choose_payment: "Credit" }, at("2026-10-16T00:00:00.000Z"))).toBe(false)
  })

  it("ecpayTradesNewestFirst keeps the provider's sessions only, newest first", () => {
    const rows = [
      { id: "a", provider_id: "pp_ecpay_ecpay", created_at: "2026-10-13T00:00:00.000Z" },
      { id: "b", provider_id: "pp_system_default", created_at: "2026-10-13T03:00:00.000Z" },
      { id: "c", provider_id: "pp_ecpay_ecpay", created_at: "2026-10-13T02:00:00.000Z" },
    ]
    expect(ecpayTradesNewestFirst(rows, "pp_ecpay_ecpay").map((s) => s.id)).toEqual(["c", "a"])
  })

  it("hasProof: a stored notice or trade answer, nothing else", () => {
    expect(hasProof({ data: { ecpay_notice: { RtnCode: "1" } } })).toBe(true)
    expect(hasProof({ data: { ecpay_trade_info: { TradeStatus: "1" } } })).toBe(true)
    expect(hasProof({ data: { ecpay_notice: null, ecpay_payment_info: { RtnCode: "2" } } })).toBe(false)
    expect(hasProof({ data: null })).toBe(false)
  })
})
