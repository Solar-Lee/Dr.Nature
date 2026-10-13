// [P5-03] Membership tier configuration. Source of truth: the tier-config JSON block in
// docs/strategy/membership.md §10 (P5-02, pending Aki's approval U-10); this file's data copy
// (src/data/membership-tiers.json) must equal it — a unit test compares the two, so the
// backend image never has to ship docs/.
// Validation follows membership.md §10.1: any problem means the engine refuses to run
// (fail closed); a config that is not "approved" never runs in production.
import { MedusaError } from "@medusajs/framework/utils"
import raw from "../../data/membership-tiers.json"

export type Tier = {
  code: string
  name: string
  min_spend_twd_12m: number
  discount_percent: number
  benefits: string[]
}

export type TierConfig = {
  schema_version: number
  config_version: string
  status: string
  approved_at: string | null
  timezone: string
  spend: {
    rolling_window_days: number
    confirm_after_delivered_days: number
    confirm_fallback_after_payment_days: number
    exclude_canceled_orders: boolean
    sales_channels: string[]
  }
  schedule: {
    downgrade_review_day_of_month: number
  }
  pricing: {
    official_price_per_bottle_twd: number
    cash_floor_per_bottle_twd: number
    gift_equivalent_floor_per_bottle_twd: number
    max_promo_gifts_per_order: number
    mutually_exclusive_offers: string[]
    member_price_min_bottles: number
    member_price_sales_channels: string[]
  }
  customer_groups: Record<string, string>
  tiers: Tier[]
  benefit_catalog: Record<string, unknown>
}

export function tierConfigProblems(c: TierConfig): string[] {
  const problems: string[] = []
  if (c.schema_version !== 1) {
    problems.push(`schema_version must be 1 (got ${c.schema_version})`)
  }
  if (!c.tiers?.length) {
    return [...problems, "tiers is empty"]
  }
  if (c.tiers[0].min_spend_twd_12m !== 0) {
    problems.push("the first tier must start at 0")
  }
  const codes = new Set<string>()
  c.tiers.forEach((t, i) => {
    if (codes.has(t.code)) {
      problems.push(`duplicate tier code ${t.code}`)
    }
    codes.add(t.code)
    if (i > 0 && !(t.min_spend_twd_12m > c.tiers[i - 1].min_spend_twd_12m)) {
      problems.push(`tier ${t.code}: thresholds must strictly increase`)
    }
    if (!(t.discount_percent >= 0 && t.discount_percent <= 100)) {
      problems.push(`tier ${t.code}: discount_percent must be 0-100`)
    }
    const price = Math.round((c.pricing.official_price_per_bottle_twd * (100 - t.discount_percent)) / 100)
    if (price < c.pricing.cash_floor_per_bottle_twd) {
      problems.push(`tier ${t.code}: ${t.discount_percent}% off gives NT$${price}, below the cash floor NT$${c.pricing.cash_floor_per_bottle_twd}`)
    }
    for (const b of t.benefits) {
      if (!(b in (c.benefit_catalog ?? {}))) {
        problems.push(`tier ${t.code}: benefit ${b} is not in benefit_catalog`)
      }
    }
  })
  for (const code of Object.keys(c.customer_groups ?? {})) {
    if (!codes.has(code)) {
      problems.push(`customer_groups.${code} is not a tier`)
    }
  }
  if (c.customer_groups?.[c.tiers[0].code]) {
    problems.push("the entry tier has no customer group (every member is in it)")
  }
  const p = c.pricing
  if (
    !(p?.official_price_per_bottle_twd > 0 && p.cash_floor_per_bottle_twd > 0 && p.cash_floor_per_bottle_twd <= p.official_price_per_bottle_twd) ||
    !(p.gift_equivalent_floor_per_bottle_twd > 0 && p.gift_equivalent_floor_per_bottle_twd <= p.cash_floor_per_bottle_twd) ||
    !(Number.isInteger(p.max_promo_gifts_per_order) && p.max_promo_gifts_per_order >= 0)
  ) {
    problems.push("pricing: need official >= cash floor >= gift-equivalent floor > 0 and an integer gift limit")
  }
  const s = c.spend
  if (!(s?.rolling_window_days > 0 && s.confirm_after_delivered_days >= 0 && s.confirm_fallback_after_payment_days > 0)) {
    problems.push("spend: window and confirmation days must be positive")
  }
  if (!s?.sales_channels?.length) {
    problems.push("spend.sales_channels is empty")
  }
  const day = c.schedule?.downgrade_review_day_of_month
  if (!(Number.isInteger(day) && day >= 1 && day <= 28)) {
    problems.push("schedule.downgrade_review_day_of_month must be 1-28")
  }
  if (c.timezone !== "Asia/Taipei") {
    problems.push("timezone must be Asia/Taipei")
  }
  return problems
}

export function loadTierConfig(c: TierConfig = raw as TierConfig): TierConfig {
  const problems = tierConfigProblems(c)
  if (problems.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `[MEMBERSHIP] invalid tier config ${c.config_version}: ${problems.join("; ")}`)
  }
  return c
}

// Proposal numbers must never drive real customers: production runs only an approved config.
export function engineBlockedReason(c: TierConfig, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV === "production" && c.status !== "approved") {
    return `tier config ${c.config_version} is "${c.status}", not approved (U-10)`
  }
  return null
}
