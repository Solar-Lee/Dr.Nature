import { appliedPromotionRefs, ecpayAmountCommitted, exclusiveOfferProblem, isLive } from "../cart-promotions"

const EXCLUSIVE = ["kol_code", "first_order_gift", "member_price"]

describe("R2: one exclusive offer per order", () => {
  it("allows one exclusive offer with any number of campaigns", () => {
    expect(exclusiveOfferProblem(["member_price", "campaign", "campaign"], EXCLUSIVE)).toBeNull()
    expect(exclusiveOfferProblem(["kol_code"], EXCLUSIVE)).toBeNull()
    expect(exclusiveOfferProblem([], EXCLUSIVE)).toBeNull()
  })

  it("refuses two different exclusive offers; two promotions of the same kind are fine", () => {
    expect(exclusiveOfferProblem(["member_price", "kol_code"], EXCLUSIVE)).toMatch(/kol_code \+ member_price/)
    expect(exclusiveOfferProblem(["first_order_gift", "kol_code", "campaign"], EXCLUSIVE)).toMatch(/first_order_gift \+ kol_code/)
    expect(exclusiveOfferProblem(["kol_code", "kol_code"], EXCLUSIVE)).toBeNull()
  })
})

describe("promotions a cart actually carries", () => {
  it("only adjustments with an amount count, from items and shipping, each promotion once; no id -> by code", () => {
    expect(
      appliedPromotionRefs({
        items: [
          { variant_sku: "DN-PB-01-060C", quantity: 2, total: 2070, adjustments: [{ promotion_id: "promo_m", amount: 115 }, { promotion_id: "promo_zero", amount: 0 }] },
          { variant_sku: "DN-PB-02-060C", quantity: 1, total: 1035, adjustments: [{ promotion_id: "promo_m", amount: 115 }] },
        ],
        shipping_methods: [{ adjustments: [{ promotion_id: "promo_ship", amount: 120 }, { code: "NOID", amount: 5 }] }],
      })
    ).toEqual({ ids: ["promo_m", "promo_ship"], codes: ["NOID"] })
    expect(appliedPromotionRefs({})).toEqual({ ids: [], codes: [] })
  })

  it("an ECPay amount counts as committed only with a verified, bound proof", () => {
    const planted = { payment_collection: { payment_sessions: [{ id: "ps_1", provider_id: "pp_ecpay_ecpay", data: { merchant_trade_no: "DN1", amount: 1150, ecpay_payment_info: { RtnCode: "2", MerchantTradeNo: "DN1" } } }] } }
    expect(ecpayAmountCommitted(planted)).toBe(false)
    expect(ecpayAmountCommitted({})).toBe(false)
  })
})

describe("still live at checkout (review promotions-2)", () => {
  const now = new Date("2026-11-15T00:01:00+08:00")
  it("active with no campaign, or inside the campaign window", () => {
    expect(isLive({ id: "p", status: "active" }, now)).toBe(true)
    expect(isLive({ id: "p", status: "active", campaign: { starts_at: "2026-11-01T00:00:00+08:00", ends_at: "2026-11-15T00:02:00+08:00" } }, now)).toBe(true)
  })
  it("not after the window ends, not before it starts, not when deactivated", () => {
    expect(isLive({ id: "p", status: "active", campaign: { ends_at: "2026-11-14T23:59:59+08:00" } }, now)).toBe(false)
    expect(isLive({ id: "p", status: "active", campaign: { ends_at: "2026-11-15T00:01:00+08:00" } }, now)).toBe(false)
    expect(isLive({ id: "p", status: "active", campaign: { starts_at: "2026-11-16T00:00:00+08:00" } }, now)).toBe(false)
    expect(isLive({ id: "p", status: "inactive" }, now)).toBe(false)
    expect(isLive({ id: "p", status: "draft" }, now)).toBe(false)
  })
})
