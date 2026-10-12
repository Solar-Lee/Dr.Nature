import { bottlesPerUnit, checkPriceFloor, orderShape, pricePolicy, type FloorItem } from "../price-floor"

const bottle = (quantity: number, total: number, sku = "DN-PB-01-060C"): FloorItem => ({ variant_sku: sku, quantity, total, unit_price: 1150 })
const gift = (quantity: number, unit_price: number, total = 0): FloorItem => ({ variant_sku: "GIFT-TEST-01", quantity, total, unit_price })

describe("price rules at checkout", () => {
  it("reads the proposal numbers from the tier config", () => {
    expect(pricePolicy()).toEqual({ officialPrice: 1150, cashFloor: 1035, giftEquivalentFloor: 862.5, maxGifts: 1 })
  })

  it("a -X{n} pack holds n bottles", () => {
    expect(bottlesPerUnit("DN-PB-01-060C")).toBe(1)
    expect(bottlesPerUnit("DN-PB-01-060C-X3")).toBe(3)
    expect(bottlesPerUnit("DN-PB-01-060C-X6")).toBe(6)
    expect(orderShape([bottle(2, 6210, "DN-PB-01-060C-X3")]).bottles).toBe(6)
  })

  it("R1: exactly NT$1,035 a bottle passes, a dollar under fails — packs included", () => {
    expect(() => checkPriceFloor([bottle(3, 3105)])).not.toThrow()
    expect(() => checkPriceFloor([bottle(3, 3104)])).toThrow(/折扣上限/)
    expect(() => checkPriceFloor([bottle(1, 3104, "DN-PB-01-060C-X3")])).toThrow(/折扣上限/)
    expect(() => checkPriceFloor([bottle(1, 1575, "DN-PB-01-060C-X3")])).toThrow(/折扣上限/)
    expect(() => checkPriceFloor([bottle(1, 6210, "DN-PB-01-060C-X6")])).not.toThrow()
  })

  it("R1 averages over every bottle line; non-bottle paid items do not count", () => {
    expect(orderShape([bottle(2, 2300), { variant_sku: "DN-PB-02-060C", quantity: 1, total: 575, unit_price: 1150 }])).toMatchObject({ bottles: 3, cash: 2875 })
    expect(() => checkPriceFloor([bottle(2, 2300), { variant_sku: "DN-PB-02-060C", quantity: 1, total: 575, unit_price: 1150 }])).toThrow()
    expect(() => checkPriceFloor([bottle(1, 1150), { variant_sku: "ACC-1", quantity: 1, total: 50, unit_price: 100 }])).not.toThrow()
  })

  it("R3: the 團購 set (3,150 + gift 750) is exactly on the 862.5 line; a member 3-pack + gift 750 is under", () => {
    expect(() => checkPriceFloor([bottle(3, 3150), gift(1, 750)])).not.toThrow()
    expect(() => checkPriceFloor([bottle(3, 3105), gift(1, 750)])).toThrow(/折扣上限/) // 850.2
    expect(() => checkPriceFloor([bottle(1, 1150), gift(1, 575)])).toThrow(/折扣上限/) // 766.7
    expect(() => checkPriceFloor([bottle(2, 2300), gift(1, 300)])).not.toThrow() // 1,017.3
  })

  it("R4: at most one free gift unit; a discounted (not free) add-on is not a gift", () => {
    expect(() => checkPriceFloor([bottle(3, 3450), gift(2, 100)])).toThrow(/最多一份贈品/)
    expect(() => checkPriceFloor([bottle(3, 3450), gift(1, 100), { variant_sku: "GIFT-TEST-02", quantity: 1, total: 0, unit_price: 50 }])).toThrow(/最多一份贈品/)
    expect(orderShape([bottle(1, 1150), gift(1, 300, 150)]).giftUnits).toBe(0)
  })

  it("accepts Medusa BigNumber-like totals; refuses to guess when totals are missing", () => {
    expect(orderShape([{ variant_sku: "DN-PB-01-060C", quantity: 2, total: { value: "2300", precision: 20 } }])).toMatchObject({ bottles: 2, cash: 2300 })
    expect(() => checkPriceFloor([])).not.toThrow()
    expect(() => checkPriceFloor([{ variant_sku: "DN-PB-01-060C", quantity: 1 }])).toThrow(/totals are missing/)
  })
})
