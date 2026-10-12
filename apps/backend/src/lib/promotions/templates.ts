// [P5-05] Campaign promotion templates. Each template turns a short, validated form into a
// Medusa CreatePromotionDTO (Medusa 2.21.2 promotion module, read from source; research
// docs/research/p4-p5-2026-10-13.md §3, law §5). Staff create them through
// POST /admin/promotion-templates; SOP docs/ops/promotions.md.
//
// Medusa facts the templates rely on:
//  - a promotion has no dates of its own: a time window ("限時") and a budget live on a
//    campaign; promotions outside the window are not found at all (listActivePromotions_);
//  - a spend threshold is a promotion rule on the cart field original_item_total (tax
//    inclusive, before discounts); the admin UI cannot set it, hence this template;
//  - buyget = buy rules (min quantity) + target rules (apply_to_quantity, max_quantity);
//  - all our prices are tax inclusive, so fixed amounts are created with is_tax_inclusive
//    (otherwise NT$200 off would be applied before the 5% tax, i.e. NT$210 off).
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import type { CreateCampaignDTO, CreatePromotionDTO, CreatePromotionRuleDTO } from "@medusajs/framework/types"

const CODE = z
  .string()
  .trim()
  .regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/, "code: 3-32 uppercase letters, digits, - or _")
const TWD = z.number().int().positive()
const PERCENT = z.number().int().min(1).max(100)
const IDS = z.array(z.string().min(1)).min(1)

// "限時" must state its period and end on time (公平交易法 §21; 公平會 §21 處理原則 附表二):
// both ends required, start before end. Times are absolute (ISO 8601 with offset, e.g.
// 2026-11-01T00:00:00+08:00); the storefront shows them in Asia/Taipei.
const WINDOW = z
  .object({ starts_at: z.iso.datetime({ offset: true }), ends_at: z.iso.datetime({ offset: true }) })
  .refine((w) => new Date(w.starts_at) < new Date(w.ends_at), "window: starts_at must be before ends_at")

// Campaign budget: "usage" = number of orders, "spend" = NT$ of discount given.
const BUDGET = z.object({ type: z.enum(["usage", "spend"]), limit: TWD })

// What kind of offer this is. 團主碼, 首購禮 and 會員價 are mutually exclusive in one order
// (membership.md §6.1 R2; checked at checkout, src/lib/pricing/offer-rules.ts).
export const OFFERS = ["campaign", "kol_code", "first_order_gift", "member_price"] as const

const COMMON = {
  code: CODE,
  name: z.string().trim().min(1).max(80),
  window: WINDOW.optional(),
  budget: BUDGET.optional(),
  // Automatic promotions apply without a code. Codes are the default: they carry the
  // group leader / channel attribution (go-to-market §1).
  automatic: z.boolean().default(false),
  // Per-promotion cap on uses (orders), on top of any campaign budget.
  limit: z.number().int().positive().optional(),
  offer: z.enum(["campaign", "kol_code", "first_order_gift"]).default("campaign"),
}

export const TEMPLATE_SCHEMA = z.discriminatedUnion("template", [
  // 滿額折: spend >= min_total_twd (tax inclusive, before discounts) -> NT$ off or % off the order.
  z
    .object({
      template: z.literal("spend_threshold"),
      ...COMMON,
      min_total_twd: TWD,
      amount_off_twd: TWD.optional(),
      percent_off: PERCENT.optional(),
    })
    .refine((t) => (t.amount_off_twd === undefined) !== (t.percent_off === undefined), "give exactly one of amount_off_twd / percent_off")
    .refine((t) => t.amount_off_twd === undefined || t.amount_off_twd < t.min_total_twd, "amount_off_twd must be below min_total_twd"),
  // 第二件折: for every N bought of the listed products, the next one is percent_off.
  // Same-product quantity discounts are not gifts (贈品贈獎額度辦法 §3 ③; 公平會 105.05.12 令).
  z.object({
    template: z.literal("nth_item"),
    ...COMMON,
    product_ids: IDS,
    buy_quantity: z.number().int().min(1).max(10).default(1),
    percent_off: PERCENT.max(99),
    max_discounted_units: z.number().int().min(1).max(50).default(5),
  }),
  // 買 X 送 Y: buy buy_quantity of buy_product_ids, get gift_quantity of gift_product_ids free.
  // A different product as gift is a 贈品: value cap checked by the route (giftValueProblem);
  // at checkout R3/R4 (src/lib/pricing/price-floor.ts) also apply.
  z.object({
    template: z.literal("buy_x_get_y"),
    ...COMMON,
    buy_product_ids: IDS,
    buy_quantity: z.number().int().min(1).max(20),
    gift_product_ids: IDS,
    gift_quantity: z.number().int().min(1).max(5).default(1),
    max_gifts: z.number().int().min(1).max(50).default(1),
  }),
  // 免運: shipping free (optionally from a spend threshold). Site-wide free shipping is already
  // the default (DEV_PLAN §2); this is for priced methods such as home delivery.
  z.object({
    template: z.literal("free_shipping"),
    ...COMMON,
    min_total_twd: TWD.optional(),
  }),
  // [P5-04] 會員價: percent off the listed products for members of the given tiers (customer
  // groups, rule customer.groups.id in [...]), optionally from a cart total. A CODE, not
  // automatic: Medusa re-adds automatic promotions on every cart refresh, so a member could
  // never choose a group-leader offer instead (R2). The storefront applies the code for
  // eligible members (P7). The route caps percent_off at the tiers' configured discount.
  z.object({
    template: z.literal("member_price"),
    ...COMMON,
    automatic: z.literal(false).default(false),
    tiers: z.array(z.string().min(1)).min(1),
    product_ids: IDS,
    percent_off: PERCENT,
    min_total_twd: TWD.optional(),
  }),
])

export type TemplateInput = z.input<typeof TEMPLATE_SCHEMA>
export type Template = z.output<typeof TEMPLATE_SCHEMA>

const productRule = (ids: string[]): CreatePromotionRuleDTO => ({ attribute: "items.product.id", operator: "in", values: ids })
const minTotalRule = (twd: number): CreatePromotionRuleDTO => ({ attribute: "original_item_total", operator: "gte", values: String(twd) })

function campaignFor(t: Template): CreateCampaignDTO | undefined {
  if (!t.window && !t.budget) {
    return undefined
  }
  return {
    name: t.name,
    campaign_identifier: t.code,
    starts_at: t.window ? new Date(t.window.starts_at) : null,
    ends_at: t.window ? new Date(t.window.ends_at) : null,
    budget: t.budget
      ? { type: t.budget.type, limit: t.budget.limit, ...(t.budget.type === "spend" ? { currency_code: "twd" } : {}) }
      : null,
  }
}

// tierGroups: tier code -> customer group id (member_price only; see lib/membership/engine.ts).
export function buildPromotion(t: Template, tierGroups: Map<string, string> = new Map()): CreatePromotionDTO {
  const campaign = campaignFor(t)
  const base = {
    code: t.code,
    status: "active" as const,
    is_automatic: t.automatic,
    is_tax_inclusive: true,
    ...(t.limit ? { limit: t.limit } : {}),
    ...(campaign ? { campaign } : {}),
    metadata: { drn_template: t.template, drn_name: t.name, drn_offer: t.template === "member_price" ? "member_price" : t.offer },
  }
  switch (t.template) {
    case "spend_threshold":
      return {
        ...base,
        type: "standard",
        rules: [minTotalRule(t.min_total_twd)],
        application_method: {
          target_type: "order",
          allocation: "across",
          currency_code: "twd",
          ...(t.amount_off_twd !== undefined
            ? { type: "fixed", value: t.amount_off_twd }
            : { type: "percentage", value: t.percent_off! }),
        },
      }
    case "nth_item":
      return {
        ...base,
        type: "buyget",
        application_method: {
          type: "percentage",
          target_type: "items",
          allocation: "each",
          value: t.percent_off,
          currency_code: "twd",
          buy_rules_min_quantity: t.buy_quantity,
          apply_to_quantity: 1,
          max_quantity: t.max_discounted_units,
          buy_rules: [productRule(t.product_ids)],
          target_rules: [productRule(t.product_ids)],
        },
      }
    case "buy_x_get_y":
      return {
        ...base,
        type: "buyget",
        application_method: {
          type: "percentage",
          target_type: "items",
          allocation: "each",
          value: 100,
          currency_code: "twd",
          buy_rules_min_quantity: t.buy_quantity,
          apply_to_quantity: t.gift_quantity,
          max_quantity: t.max_gifts * t.gift_quantity,
          buy_rules: [productRule(t.buy_product_ids)],
          target_rules: [productRule(t.gift_product_ids)],
        },
      }
    case "member_price": {
      const groups = t.tiers.map((code) => tierGroups.get(code))
      if (groups.some((g) => !g)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `member_price: no customer group for tier(s) ${t.tiers.filter((c, i) => !groups[i]).join(", ")}`)
      }
      return {
        ...base,
        type: "standard",
        rules: [
          { attribute: "customer.groups.id", operator: "in", values: groups as string[] },
          ...(t.min_total_twd ? [minTotalRule(t.min_total_twd)] : []),
        ],
        application_method: {
          type: "percentage",
          target_type: "items",
          allocation: "across",
          value: t.percent_off,
          currency_code: "twd",
          target_rules: [productRule(t.product_ids)],
        },
      }
    }
    case "free_shipping":
      return {
        ...base,
        type: "standard",
        ...(t.min_total_twd ? { rules: [minTotalRule(t.min_total_twd)] } : {}),
        application_method: {
          type: "percentage",
          target_type: "shipping_methods",
          allocation: "across",
          value: 100,
          currency_code: "twd",
        },
      }
  }
}

// 事業提供贈品贈獎額度辦法 §4 (docs/research/gift-rules-2026-10-13.md): a gift that is a DIFFERENT
// product may be worth at most half of the purchase when the purchase is NT$100 or more, else
// NT$50 (at exactly NT$100 both give NT$50). Uses the lowest price the shopper could pay for
// the buy side and the highest gift price. Gifting the same product is a quantity discount
// (§3 ③, not a gift) and is left to the price rules at checkout (price-floor.ts).
export type PriceRange = { min: number; max: number }

export function giftValueProblem(
  t: Extract<Template, { template: "buy_x_get_y" }>,
  unitPrices: Map<string, PriceRange>
): string | null {
  if (t.gift_product_ids.some((id) => t.buy_product_ids.includes(id))) {
    return null
  }
  const missing = [...t.buy_product_ids, ...t.gift_product_ids].filter((id) => !unitPrices.has(id))
  if (missing.length) {
    return `no TWD price for product(s) ${missing.join(", ")}`
  }
  const purchase = Math.min(...t.buy_product_ids.map((id) => unitPrices.get(id)!.min)) * t.buy_quantity
  const gift = Math.max(...t.gift_product_ids.map((id) => unitPrices.get(id)!.max)) * t.gift_quantity
  const cap = purchase >= 100 ? purchase / 2 : 50
  return gift > cap ? `gift worth NT$${gift} exceeds the legal cap NT$${cap} for a NT$${purchase} purchase (事業提供贈品贈獎額度辦法 §4)` : null
}
