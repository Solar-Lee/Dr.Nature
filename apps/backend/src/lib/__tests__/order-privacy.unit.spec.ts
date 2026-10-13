import { maskAddress, maskEmail, maskName, maskOrder, maskOrderBody, maskPhone } from "../order-privacy"

describe("order privacy masks (review logistics-1)", () => {
  it("e-mail keeps the first character and the domain", () => {
    expect(maskEmail("buyer@drn.test")).toBe("b***@drn.test")
    expect(maskEmail("a@x.tw")).toBe("a***@x.tw")
    expect(maskEmail("no-at-sign")).toBe("***")
    expect(maskEmail(null)).toBeNull()
  })

  it("names keep the first character (CJK aware), phones the first 2 and last 3 digits", () => {
    expect(maskName("王小明")).toBe("王○○")
    expect(maskName("林")).toBe("林○")
    expect(maskName("𠮷野家")).toBe("𠮷○○")
    expect(maskPhone("0912345678")).toBe("09*****678")
    expect(maskPhone("12345")).toBe("***")
    expect(maskPhone("")).toBe("")
  })

  it("addresses lose street, company and metadata; city and postal code stay", () => {
    expect(maskAddress({ first_name: "王", last_name: "小明", address_1: "信義路", address_2: "", company: "x", city: "台北市", postal_code: "110", phone: "0912345678", metadata: { a: 1 } })).toEqual({
      first_name: "王○",
      last_name: "小○",
      address_1: "***",
      address_2: "",
      company: "***",
      city: "台北市",
      postal_code: "110",
      phone: "09*****678",
      metadata: null,
    })
  })

  it("orders lose the cart link and keep only what a confirmation page needs from fulfillments and sessions", () => {
    const o = maskOrder({
      email: "buyer@drn.test",
      cart: { id: "cart_1" },
      customer: { id: "cus_1", email: "buyer@drn.test", phone: "0912345678" },
      fulfillments: [{ id: "ful_1", data: { store: { store_id: "131386" }, ecpay_cvs_validation_no: "4471" }, metadata: { ecpay_status: { code: "2067" }, ecpay_store_updates: [] } }],
      payment_collections: [{ payment_sessions: [{ id: "ps_1", data: { checkout_form: { action: "x" }, merchant_trade_no: "DN1", ecpay_notice: { TradeNo: "1" } } }] }],
      items: [{ id: "i" }],
    }) as any
    expect(o.cart).toBeUndefined()
    expect(o.customer).toEqual({ id: "cus_1", email: "b***@drn.test" })
    expect(o.fulfillments[0].data).toEqual({ store: { store_id: "131386" } })
    expect(o.fulfillments[0].metadata).toEqual({ ecpay_status: { code: "2067" } })
    expect(o.payment_collections[0].payment_sessions[0].data).toEqual({ checkout_form: { action: "x" } })
    expect(o.items).toEqual([{ id: "i" }])
  })

  it("bodies without an order (errors, other routes) are untouched", () => {
    const err = { type: "not_found", message: "x" }
    expect(maskOrderBody(err)).toBe(err)
    expect(maskOrderBody(null)).toBeNull()
    expect(maskOrderBody({ type: "cart", cart: { email: "a@b.c" } })).toEqual({ type: "cart", cart: { email: "a@b.c" } })
  })
})
