import { readFileSync } from "fs"
import { join } from "path"
import raw from "../../../data/membership-tiers.json"
import { engineBlockedReason, loadTierConfig, tierConfigProblems, type TierConfig } from "../config"
import { decideTier, latestReviewInstant, orderContribution, reviewWindowStart, spendOf, taipeiDayOfMonth, tierForSpend, type SpendOrder } from "../rules"

const DAY = 24 * 3600 * 1000
const cfg = () => JSON.parse(JSON.stringify(raw)) as TierConfig

describe("tier config", () => {
  it("the backend copy equals the tier-config block of docs/strategy/membership.md", () => {
    const doc = readFileSync(join(__dirname, "../../../../../../docs/strategy/membership.md"), "utf8")
    const m = doc.match(/<!-- tier-config:begin -->\s*```json\n([\s\S]*?)```\s*<!-- tier-config:end -->/)
    expect(m).not.toBeNull()
    expect(JSON.parse(m![1])).toEqual(raw)
  })

  it("the shipped config is valid", () => {
    expect(tierConfigProblems(cfg())).toEqual([])
    expect(() => loadTierConfig()).not.toThrow()
  })

  it("refuses a config that breaks the §10.1 rules", () => {
    const broken = (f: (c: TierConfig) => void) => {
      const c = cfg()
      f(c)
      return tierConfigProblems(c).join("; ")
    }
    expect(broken((c) => (c.schema_version = 2))).toMatch(/schema_version/)
    expect(broken((c) => (c.tiers[0].min_spend_twd_12m = 100))).toMatch(/start at 0/)
    expect(broken((c) => (c.tiers[2].min_spend_twd_12m = c.tiers[1].min_spend_twd_12m))).toMatch(/strictly increase/)
    expect(broken((c) => (c.tiers[2].code = c.tiers[1].code))).toMatch(/duplicate tier code/)
    expect(broken((c) => (c.tiers[1].discount_percent = 11))).toMatch(/below the cash floor/)
    expect(broken((c) => c.tiers[1].benefits.push("free_money"))).toMatch(/free_money is not in benefit_catalog/)
    expect(broken((c) => (c.customer_groups.member = "tier-member"))).toMatch(/entry tier has no customer group/)
    expect(broken((c) => (c.schedule.downgrade_review_day_of_month = 31))).toMatch(/1-28/)
    expect(broken((c) => (c.pricing.gift_equivalent_floor_per_bottle_twd = 1100))).toMatch(/gift-equivalent floor/)
    expect(broken((c) => (c.pricing.max_promo_gifts_per_order = 1.5))).toMatch(/gift limit/)
    expect(() => loadTierConfig({ ...cfg(), schema_version: 9 })).toThrow(/invalid tier config/)
  })

  it("a config that is not approved never runs in production", () => {
    expect(engineBlockedReason({ ...cfg(), status: "proposal" }, { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toMatch(/not approved/)
    expect(engineBlockedReason({ ...cfg(), status: "approved" }, { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBeNull()
    expect(engineBlockedReason({ ...cfg(), status: "proposal" }, { NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBeNull()
  })
})

describe("spend rules", () => {
  const c = cfg()
  const now = new Date("2027-03-15T04:00:00Z")
  const channels = new Set(["sc_official"])
  const order = (o: Partial<SpendOrder> = {}): SpendOrder => ({
    id: "order_1",
    status: "completed",
    sales_channel_id: "sc_official",
    captured_at: new Date(now.getTime() - 40 * DAY),
    paid_total: 1150,
    refunded_total: 0,
    all_items_fulfilled: true,
    deliveries: [new Date(now.getTime() - 10 * DAY)],
    ...o,
  })

  it("delivered 10 days ago counts; 9 days ago is still pending", () => {
    expect(orderContribution(order(), c, channels, now)).toMatchObject({ kind: "confirmed", amount: 1150 })
    expect(orderContribution(order({ deliveries: [new Date(now.getTime() - 9 * DAY)] }), c, channels, now)).toMatchObject({ kind: "pending" })
  })

  it("every live shipment must be delivered; the last delivery counts", () => {
    expect(orderContribution(order({ deliveries: [new Date(now.getTime() - 20 * DAY), new Date(now.getTime() - 3 * DAY)] }), c, channels, now).kind).toBe("pending")
    expect(orderContribution(order({ deliveries: [new Date(now.getTime() - 20 * DAY), null] }), c, channels, now).kind).toBe("confirmed") // 40 days after payment: fallback
    expect(orderContribution(order({ captured_at: new Date(now.getTime() - 29 * DAY), deliveries: [null] }), c, channels, now).kind).toBe("pending")
  })

  it("a partially fulfilled order waits for the payment fallback, even when the shipped part was delivered", () => {
    const partial = order({ all_items_fulfilled: false, captured_at: new Date(now.getTime() - 12 * DAY), deliveries: [new Date(now.getTime() - 11 * DAY)] })
    expect(orderContribution(partial, c, channels, now)).toMatchObject({ kind: "pending" })
    expect(orderContribution({ ...partial, captured_at: new Date(now.getTime() - 30 * DAY) }, c, channels, now).kind).toBe("confirmed")
  })

  it("an explicit window start replaces now - 365 days", () => {
    const old = order({ captured_at: new Date(now.getTime() - 380 * DAY) })
    expect(orderContribution(old, c, channels, now).kind).toBe("excluded")
    expect(orderContribution(old, c, channels, now, new Date(now.getTime() - 400 * DAY)).kind).toBe("confirmed")
  })

  it("no delivery record: counts 30 days after payment", () => {
    expect(orderContribution(order({ captured_at: new Date(now.getTime() - 30 * DAY), deliveries: [] }), c, channels, now).kind).toBe("confirmed")
    expect(orderContribution(order({ captured_at: new Date(now.getTime() - 29 * DAY), deliveries: [] }), c, channels, now).kind).toBe("pending")
  })

  it("refunds are subtracted; canceled, unpaid, other channels and old payments do not count", () => {
    expect(orderContribution(order({ paid_total: 2300, refunded_total: 575 }), c, channels, now).amount).toBe(1725)
    expect(orderContribution(order({ refunded_total: 1150 }), c, channels, now).kind).toBe("excluded")
    expect(orderContribution(order({ status: "canceled" }), c, channels, now).kind).toBe("excluded")
    expect(orderContribution(order({ captured_at: null }), c, channels, now).kind).toBe("excluded")
    expect(orderContribution(order({ sales_channel_id: "sc_marketplace" }), c, channels, now).kind).toBe("excluded")
    expect(orderContribution(order({ captured_at: new Date(now.getTime() - 365 * DAY) }), c, channels, now).kind).toBe("excluded")
    expect(orderContribution(order({ captured_at: new Date(now.getTime() - 364 * DAY) }), c, channels, now).kind).toBe("confirmed")
  })

  it("adds confirmed and pending separately", () => {
    expect(spendOf([order(), order({ deliveries: [null], captured_at: new Date(now.getTime() - DAY) })], c, channels, now)).toEqual({ confirmed: 1150, pending: 1150 })
  })
})

describe("tier decisions", () => {
  const c = cfg()

  it("thresholds: 1,035 回購會員, 9,315 長期會員", () => {
    expect(tierForSpend(c, 1034).code).toBe("member")
    expect(tierForSpend(c, 1035).code).toBe("repeat")
    expect(tierForSpend(c, 9314).code).toBe("repeat")
    expect(tierForSpend(c, 9315).code).toBe("loyal")
  })

  it("upgrades at once, across levels", () => {
    expect(decideTier(c, "member", 9315, 9315)).toEqual({ code: "loyal", change: "up" })
  })

  it("an order that only left the window keeps the tier until the review day (held)", () => {
    // spend now 0 (expired), spend with the window anchored at the last review day still 9,315
    expect(decideTier(c, "loyal", 0, 9315)).toEqual({ code: "loyal", change: "held" })
  })

  it("money not received (refund / cancel) lowers the review-anchored spend too: down at once", () => {
    expect(decideTier(c, "loyal", 1035, 1035)).toEqual({ code: "repeat", change: "down" })
    expect(decideTier(c, "repeat", 0, 0)).toEqual({ code: "member", change: "down" })
  })

  it("a held member stays held when an unrelated unpaid order is canceled (spend unchanged)", () => {
    expect(decideTier(c, "repeat", 0, 1150)).toEqual({ code: "repeat", change: "held" })
  })

  it("nothing changes when spend still fits the tier", () => {
    expect(decideTier(c, "repeat", 2000, 2000)).toEqual({ code: "repeat", change: "none" })
  })
})

describe("review instants (Asia/Taipei)", () => {
  it("is 00:00 Taipei on the review day of this month, or of last month before it", () => {
    expect(latestReviewInstant(new Date("2027-04-01T00:00:00+08:00"), 1)).toEqual(new Date("2027-03-31T16:00:00Z"))
    expect(latestReviewInstant(new Date("2027-03-31T23:59:59+08:00"), 1)).toEqual(new Date("2027-02-28T16:00:00Z"))
    expect(latestReviewInstant(new Date("2027-01-15T12:00:00+08:00"), 20)).toEqual(new Date("2026-12-19T16:00:00Z"))
  })

  it("the review-anchored window starts 365 days before that instant", () => {
    expect(reviewWindowStart(cfg(), new Date("2027-04-10T12:00:00+08:00"))).toEqual(new Date(new Date("2027-03-31T16:00:00Z").getTime() - 365 * DAY))
  })

  it("the review day is the Taipei calendar day", () => {
    expect(taipeiDayOfMonth(new Date("2027-03-31T16:00:00Z"))).toBe(1) // 00:00 on 4/1 in Taipei
    expect(taipeiDayOfMonth(new Date("2027-03-31T15:59:59Z"))).toBe(31)
  })
})
