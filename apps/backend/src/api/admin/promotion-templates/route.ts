// [P5-05] Create a campaign promotion from a template (src/lib/promotions/templates.ts).
// RBAC: promotion:create + campaign:create (middlewares.ts; operations and Super Admin).
// Body: { template: "spend_threshold" | "nth_item" | "buy_x_get_y" | "free_shipping" | "member_price", code,
// name, window?, budget?, automatic?, limit?, ...template fields }. SOP: docs/ops/promotions.md.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createPromotionsWorkflow } from "@medusajs/medusa/core-flows"
import { loadTierConfig } from "../../../lib/membership/config"
import { tierGroupIds } from "../../../lib/membership/engine"
import { TEMPLATE_SCHEMA, buildPromotion, giftValueProblem, type PriceRange, type Template } from "../../../lib/promotions/templates"

const productIdsOf = (t: Template): string[] =>
  t.template === "nth_item" || t.template === "member_price"
    ? t.product_ids
    : t.template === "buy_x_get_y"
      ? [...t.buy_product_ids, ...t.gift_product_ids]
      : []

// TWD price range of each product (over its variants), for the gift cap; unknown ids are absent.
async function productPrices(container: MedusaContainer, ids: string[]): Promise<Map<string, PriceRange>> {
  const { data } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "product",
    fields: ["id", "variants.prices.amount", "variants.prices.currency_code"],
    filters: { id: ids },
  })
  const out = new Map<string, PriceRange>()
  for (const p of data as { id: string; variants?: { prices?: { amount: unknown; currency_code: string }[] }[] }[]) {
    const twd = (p.variants ?? []).flatMap((v) => (v.prices ?? []).filter((x) => x.currency_code === "twd").map((x) => Number(x.amount)))
    out.set(p.id, twd.length ? { min: Math.min(...twd), max: Math.max(...twd) } : { min: NaN, max: NaN })
  }
  return out
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = TEMPLATE_SCHEMA.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")
    )
  }
  const t = parsed.data
  const ids = [...new Set(productIdsOf(t))]
  if (ids.length) {
    const prices = await productPrices(req.scope, ids)
    // A rule on an unknown product would make the promotion silently never apply.
    const unknown = ids.filter((id) => !prices.has(id))
    if (unknown.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `unknown product(s): ${unknown.join(", ")}`)
    }
    if (t.template === "buy_x_get_y") {
      const problem = giftValueProblem(t, new Map([...prices].filter(([, r]) => Number.isFinite(r.min))))
      if (problem) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, problem)
      }
    }
  }
  let tierGroups = new Map<string, string>()
  if (t.template === "member_price") {
    // The tier config is the authority on member discounts (membership.md §10).
    const c = loadTierConfig()
    const tiers = t.tiers.map((code) => c.tiers.find((x) => x.code === code))
    const unknown = t.tiers.filter((code, i) => !tiers[i] || !c.customer_groups[code])
    if (unknown.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `tiers without a customer group: ${unknown.join(", ")}`)
    }
    const cap = Math.min(...tiers.map((x) => x!.discount_percent))
    if (t.percent_off > cap) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `percent_off ${t.percent_off} exceeds the tier discount ${cap}% (membership config)`)
    }
    tierGroups = await tierGroupIds(req.scope, c)
  }
  const { result } = await createPromotionsWorkflow(req.scope).run({ input: { promotionsData: [buildPromotion(t, tierGroups)] } })
  res.status(201).json({ promotion: result[0] })
}
