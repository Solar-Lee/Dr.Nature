import { exclusiveOfferProblem } from "../offer-rules"

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
