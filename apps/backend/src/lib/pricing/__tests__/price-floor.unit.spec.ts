import { PRICE_FLOOR, bottleCash, checkPriceFloor } from "../price-floor"

const bottle = (quantity: number, total: number) => ({ variant_sku: "DN-PB-01-060C", quantity, total })

describe("price floor", () => {
  it("is NT$1,035 per bottle for DN-PB- SKUs (go-to-market proposal)", () => {
    expect(PRICE_FLOOR).toEqual({ skuPrefix: "DN-PB-", minUnitCashTwd: 1035 })
  })

  it("exactly the floor passes; a dollar under fails", () => {
    expect(() => checkPriceFloor([bottle(3, 3105)])).not.toThrow()
    expect(() => checkPriceFloor([bottle(3, 3104)])).toThrow(/折扣上限/)
  })

  it("averages over every bottle line; other products are not counted", () => {
    const gift = { variant_sku: "GIFT-TEST-01", quantity: 1, total: 0 }
    expect(bottleCash([bottle(2, 2300), gift, { variant_sku: "DN-PB-02-060C", quantity: 1, total: 575 }])).toEqual({ units: 3, cash: 2875 })
    expect(() => checkPriceFloor([bottle(2, 2300), gift])).not.toThrow()
    expect(() => checkPriceFloor([bottle(2, 2300), { variant_sku: "DN-PB-02-060C", quantity: 1, total: 575 }])).toThrow()
  })

  it("accepts Medusa BigNumber-like totals; a cart without bottles passes", () => {
    expect(bottleCash([{ variant_sku: "DN-PB-01-060C", quantity: 2, total: { value: "2300", precision: 20 } }])).toEqual({ units: 2, cash: 2300 })
    expect(() => checkPriceFloor([{ variant_sku: "GIFT-1", quantity: 1, total: 0 }])).not.toThrow()
    expect(() => checkPriceFloor([])).not.toThrow()
  })

  it("refuses to guess when line totals are missing", () => {
    expect(() => checkPriceFloor([{ variant_sku: "DN-PB-01-060C", quantity: 1 }])).toThrow(/totals are missing/)
  })
})
