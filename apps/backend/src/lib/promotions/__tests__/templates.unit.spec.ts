import { TEMPLATE_SCHEMA, buildPromotion, giftValueProblem, type Template } from "../templates"

const parse = (body: Record<string, unknown>) => TEMPLATE_SCHEMA.parse(body)

describe("template forms", () => {
  it("滿額折 takes exactly one of amount / percent, below the threshold", () => {
    const base = { template: "spend_threshold", code: "SPEND3000", name: "x", min_total_twd: 3000 }
    expect(TEMPLATE_SCHEMA.safeParse({ ...base, amount_off_twd: 200 }).success).toBe(true)
    expect(TEMPLATE_SCHEMA.safeParse({ ...base, percent_off: 5 }).success).toBe(true)
    expect(TEMPLATE_SCHEMA.safeParse(base).success).toBe(false)
    expect(TEMPLATE_SCHEMA.safeParse({ ...base, amount_off_twd: 200, percent_off: 5 }).success).toBe(false)
    expect(TEMPLATE_SCHEMA.safeParse({ ...base, amount_off_twd: 3000 }).success).toBe(false)
  })

  it("codes are 3-32 uppercase letters, digits, - or _", () => {
    const f = (code: string) => TEMPLATE_SCHEMA.safeParse({ template: "free_shipping", code, name: "x" }).success
    expect(f("GL-AMY_01")).toBe(true)
    expect(f("ab1")).toBe(false)
    expect(f("AB")).toBe(false)
    expect(f("A".repeat(33))).toBe(false)
  })

  it("a 限時 window needs both ends with an offset, start before end", () => {
    const f = (window: unknown) => TEMPLATE_SCHEMA.safeParse({ template: "free_shipping", code: "WIN", name: "x", window }).success
    expect(f({ starts_at: "2026-11-01T00:00:00+08:00", ends_at: "2026-11-14T23:59:59+08:00" })).toBe(true)
    expect(f({ starts_at: "2026-11-01T00:00:00+08:00" })).toBe(false)
    expect(f({ starts_at: "2026-11-14T00:00:00+08:00", ends_at: "2026-11-01T00:00:00+08:00" })).toBe(false)
    expect(f({ starts_at: "2026-11-01T00:00:00", ends_at: "2026-11-14T00:00:00" })).toBe(false)
  })
})

describe("built promotions", () => {
  it("滿額折: order-wide, tax-inclusive fixed amount, threshold on original_item_total", () => {
    const p = buildPromotion(parse({ template: "spend_threshold", code: "SPEND3000", name: "滿三千折兩百", min_total_twd: 3000, amount_off_twd: 200 }))
    expect(p).toMatchObject({
      code: "SPEND3000",
      type: "standard",
      status: "active",
      is_automatic: false,
      is_tax_inclusive: true,
      rules: [{ attribute: "original_item_total", operator: "gte", values: "3000" }],
      application_method: { type: "fixed", value: 200, target_type: "order", allocation: "across", currency_code: "twd" },
      metadata: { drn_template: "spend_threshold", drn_name: "滿三千折兩百" },
    })
    expect(p.campaign).toBeUndefined()
  })

  it("第二件折: buy N, the next one percent off, same products on both sides", () => {
    const p = buildPromotion(parse({ template: "nth_item", code: "SECOND90", name: "x", product_ids: ["prod_a"], percent_off: 10 }))
    expect(p).toMatchObject({
      type: "buyget",
      application_method: {
        type: "percentage",
        value: 10,
        buy_rules_min_quantity: 1,
        apply_to_quantity: 1,
        max_quantity: 5,
        buy_rules: [{ attribute: "items.product.id", operator: "in", values: ["prod_a"] }],
        target_rules: [{ attribute: "items.product.id", operator: "in", values: ["prod_a"] }],
      },
    })
  })

  it("買 X 送 Y: gift 100% off, max = gifts x gift quantity", () => {
    const p = buildPromotion(
      parse({ template: "buy_x_get_y", code: "BUY2GIFT", name: "x", buy_product_ids: ["prod_a"], buy_quantity: 2, gift_product_ids: ["prod_g"], gift_quantity: 2, max_gifts: 3 })
    )
    expect(p.application_method).toMatchObject({ value: 100, buy_rules_min_quantity: 2, apply_to_quantity: 2, max_quantity: 6 })
    expect(p.application_method.target_rules).toEqual([{ attribute: "items.product.id", operator: "in", values: ["prod_g"] }])
  })

  it("免運: 100% of shipping, optional threshold", () => {
    expect(buildPromotion(parse({ template: "free_shipping", code: "SHIPFREE", name: "x" }))).toMatchObject({
      application_method: { type: "percentage", value: 100, target_type: "shipping_methods", allocation: "across" },
    })
    expect(buildPromotion(parse({ template: "free_shipping", code: "SHIPFREE", name: "x" })).rules).toBeUndefined()
    expect(buildPromotion(parse({ template: "free_shipping", code: "SHIP2000", name: "x", min_total_twd: 2000 })).rules).toEqual([
      { attribute: "original_item_total", operator: "gte", values: "2000" },
    ])
  })

  it("window and budget become a campaign (spend budgets in TWD)", () => {
    const p = buildPromotion(
      parse({
        template: "free_shipping",
        code: "W11",
        name: "雙十一",
        window: { starts_at: "2026-11-11T00:00:00+08:00", ends_at: "2026-11-11T23:59:59+08:00" },
        budget: { type: "spend", limit: 50000 },
        limit: 300,
      })
    )
    expect(p.limit).toEqual(300)
    expect(p.campaign).toEqual({
      name: "雙十一",
      campaign_identifier: "W11",
      starts_at: new Date("2026-11-10T16:00:00Z"),
      ends_at: new Date("2026-11-11T15:59:59Z"),
      budget: { type: "spend", limit: 50000, currency_code: "twd" },
    })
    const usage = buildPromotion(parse({ template: "free_shipping", code: "USE1", name: "x", budget: { type: "usage", limit: 1 } }))
    expect(usage.campaign).toMatchObject({ starts_at: null, ends_at: null, budget: { type: "usage", limit: 1 } })
    expect(usage.campaign?.budget?.currency_code).toBeUndefined()
  })
})

describe("gift value cap (贈品贈獎額度辦法 §3)", () => {
  const t = (over: Partial<Extract<Template, { template: "buy_x_get_y" }>> = {}) =>
    ({ ...parse({ template: "buy_x_get_y", code: "GIFT1", name: "x", buy_product_ids: ["a"], buy_quantity: 1, gift_product_ids: ["g"] }), ...over }) as Extract<
      Template,
      { template: "buy_x_get_y" }
    >
  const prices = (a: number, g: number) => new Map([["a", { min: a, max: a }], ["g", { min: g, max: g }]])

  it("allows up to half of the purchase, refuses above", () => {
    expect(giftValueProblem(t(), prices(1150, 575))).toBeNull()
    expect(giftValueProblem(t(), prices(1150, 576))).toMatch(/exceeds the legal cap NT\$575/)
    expect(giftValueProblem(t({ buy_quantity: 2 }), prices(1150, 1150))).toBeNull()
    expect(giftValueProblem(t({ gift_quantity: 2 }), prices(1150, 300))).toMatch(/NT\$600/)
  })

  it("under NT$100 the cap is NT$50", () => {
    expect(giftValueProblem(t(), prices(99, 50))).toBeNull()
    expect(giftValueProblem(t(), prices(99, 51))).toMatch(/cap NT\$50/)
  })

  it("uses the cheapest buy variant and the dearest gift variant", () => {
    const m = new Map([["a", { min: 1000, max: 1150 }], ["g", { min: 400, max: 501 }]])
    expect(giftValueProblem(t(), m)).toMatch(/NT\$501/)
  })

  it("the same product as gift is a quantity discount, not a gift; unknown prices are refused", () => {
    expect(giftValueProblem(t({ gift_product_ids: ["a"] }), prices(1150, 1150))).toBeNull()
    expect(giftValueProblem(t(), new Map([["a", { min: 1150, max: 1150 }]]))).toMatch(/no TWD price for product\(s\) g/)
  })
})
