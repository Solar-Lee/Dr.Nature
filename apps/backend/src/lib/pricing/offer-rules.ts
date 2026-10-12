// [P5-04] R2 (docs/strategy/membership.md §6.1): a group-leader code (團主碼), a first-order gift
// (首購禮) and the member price (會員價) never share one order. Promotions carry their kind in
// metadata.drn_offer (src/lib/promotions/templates.ts); promotions without it (made by hand in
// the admin) count as "campaign". Checked when the cart completes.
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { loadTierConfig } from "../membership/config"

export function exclusiveOfferProblem(offers: string[], exclusive: string[]): string | null {
  const used = [...new Set(offers.filter((o) => exclusive.includes(o)))]
  return used.length > 1 ? `exclusive offers combined: ${used.sort().join(" + ")}` : null
}

export async function checkExclusiveOffers(promotionIds: string[], container: MedusaContainer) {
  if (!promotionIds.length) {
    return
  }
  const promotions = await container.resolve(Modules.PROMOTION).listPromotions({ id: promotionIds }, { select: ["id", "metadata"] })
  const offers = promotions.map((p) => String((p.metadata as Record<string, unknown> | null)?.drn_offer ?? "campaign"))
  if (exclusiveOfferProblem(offers, loadTierConfig().pricing.mutually_exclusive_offers)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "團主優惠碼、首購禮與會員價只能擇一，請移除其中一個優惠碼後再結帳。")
  }
}
