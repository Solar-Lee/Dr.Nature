import { TEMPLATE_SCHEMA, automaticExclusiveProblem, buildPromotion, giftValueProblem, type Template } from "../templates"

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

describe("gift value cap (事業提供贈品贈獎額度辦法 §4)", () => {
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

  it("at or under NT$100 the cap is NT$50", () => {
    expect(giftValueProblem(t(), prices(99, 50))).toBeNull()
    expect(giftValueProblem(t(), prices(99, 51))).toMatch(/cap NT\$50/)
    expect(giftValueProblem(t(), prices(100, 51))).toMatch(/cap NT\$50/)
  })

  it("uses the cheapest buy variant and the dearest gift variant", () => {
    const m = new Map([["a", { min: 1000, max: 1150 }], ["g", { min: 400, max: 501 }]])
    expect(giftValueProblem(t(), m)).toMatch(/NT\$501/)
  })

  it("a gift list mixing the bought product and another product still checks the other one", () => {
    const m = new Map([["a", { min: 1150, max: 1150 }], ["g", { min: 900, max: 900 }]])
    expect(giftValueProblem(t({ gift_product_ids: ["a", "g"] }), m)).toMatch(/NT\$900 exceeds the legal cap NT\$575/)
  })

  it("the same product as gift is a quantity discount, not a gift; unknown prices are refused", () => {
    expect(giftValueProblem(t({ gift_product_ids: ["a"] }), prices(1150, 1150))).toBeNull()
    expect(giftValueProblem(t(), new Map([["a", { min: 1150, max: 1150 }]]))).toMatch(/no TWD price for product\(s\) g/)
  })
})

describe("member price (P5-04)", () => {
  const groups = new Map([["repeat", "cusgroup_r"], ["loyal", "cusgroup_l"]])

  it("is a code limited to the tier groups (customer.groups.id in), tax-inclusive percent across the bottles", () => {
    const p = buildPromotion(
      parse({ template: "member_price", code: "MEMBER-PRICE", name: "會員回購價", tiers: ["repeat", "loyal"], product_ids: ["prod_a"], percent_off: 10, min_total_twd: 2300 }),
      { tierGroups: groups, salesChannelIds: ["sc_official"] }
    )
    expect(p).toMatchObject({
      code: "MEMBER-PRICE",
      type: "standard",
      is_automatic: false,
      is_tax_inclusive: true,
      rules: [
        { attribute: "customer.groups.id", operator: "in", values: ["cusgroup_r", "cusgroup_l"] },
        { attribute: "sales_channel_id", operator: "in", values: ["sc_official"] },
        { attribute: "original_item_total", operator: "gte", values: "2300" },
      ],
      application_method: { type: "percentage", value: 10, target_type: "items", allocation: "across", target_rules: [{ attribute: "items.product.id", operator: "in", values: ["prod_a"] }] },
      metadata: { drn_offer: "member_price" },
    })
  })

  it("cannot be automatic, and needs a group for every tier", () => {
    expect(TEMPLATE_SCHEMA.safeParse({ template: "member_price", code: "MP1", name: "x", tiers: ["repeat"], product_ids: ["a"], percent_off: 10, automatic: true }).success).toBe(false)
    expect(() => buildPromotion(parse({ template: "member_price", code: "MP2", name: "x", tiers: ["member"], product_ids: ["a"], percent_off: 5 }), { tierGroups: groups })).toThrow(/no customer group for tier\(s\) member/)
  })

  it("other templates carry their offer kind (campaign by default)", () => {
    expect(buildPromotion(parse({ template: "free_shipping", code: "SHIP1", name: "x" })).metadata).toMatchObject({ drn_offer: "campaign" })
    expect(buildPromotion(parse({ template: "free_shipping", code: "GL-1", name: "x", offer: "kol_code" })).metadata).toMatchObject({ drn_offer: "kol_code" })
    expect(TEMPLATE_SCHEMA.safeParse({ template: "free_shipping", code: "SHIP2", name: "x", offer: "member_price" }).success).toBe(false)
  })
})

describe("automatic exclusive offers (review promotions-4)", () => {
  const EXCLUSIVE = ["kol_code", "first_order_gift", "member_price"]
  const base = { template: "spend_threshold", code: "AUTO1", name: "x", min_total_twd: 1000, amount_off_twd: 100 }

  it("leader codes and first-order gifts cannot be automatic; campaigns can", () => {
    expect(automaticExclusiveProblem(parse({ ...base, automatic: true, offer: "first_order_gift" }), EXCLUSIVE)).toMatch(/must be codes/)
    expect(automaticExclusiveProblem(parse({ ...base, automatic: true, offer: "kol_code" }), EXCLUSIVE)).toMatch(/must be codes/)
    expect(automaticExclusiveProblem(parse({ ...base, automatic: true }), EXCLUSIVE)).toBeNull()
    expect(automaticExclusiveProblem(parse({ ...base, offer: "kol_code" }), EXCLUSIVE)).toBeNull()
  })
})
