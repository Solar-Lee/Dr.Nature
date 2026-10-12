// [P5-05] Price discipline at checkout (docs/strategy/membership.md §6.1; go-to-market §1), proposal
// values pending Aki (U-10). Numbers come from the tier config (src/data/membership-tiers.json,
// pricing.*), the single source shared with the tier engine.
//  - Bottles: line items whose variant SKU starts with DN-PB- (docs/product/sku-coding.md); a
//    pack SKU ending -X{n} (e.g. DN-PB-01-060C-X3) holds n bottles. Free bottles count as
//    bottles (買二送一 of the same product lowers the average).
//  - Gift: any other line that ends up free (total 0, unit price > 0); its market value is the
//    variant's unit price x quantity.
//  - R1 cash floor: bottle cash / bottles >= cash_floor_per_bottle_twd (1,035 = 1,150 x 90%).
//  - R3 gift-equivalent floor: bottle cash / (bottles + gift value / official price)
//    >= gift_equivalent_floor_per_bottle_twd (862.5 = 75% of 1,150).
//  - R4: at most max_promo_gifts_per_order free gift units per order.
// Checked when the cart completes (src/workflows/hooks/complete-cart-validate.ts), so it also
// covers promotions created by hand in the admin, not only the templates. Messages never reveal
// the floor numbers.
import { MathBN, MedusaError } from "@medusajs/framework/utils"
import { loadTierConfig } from "../membership/config"

export const BOTTLE_SKU_PREFIX = "DN-PB-"

export type FloorItem = { variant_sku?: string | null; quantity?: unknown; total?: unknown; unit_price?: unknown }

export type PricePolicy = {
  officialPrice: number
  cashFloor: number
  giftEquivalentFloor: number
  maxGifts: number
}

export function pricePolicy(): PricePolicy {
  const p = loadTierConfig().pricing
  return {
    officialPrice: p.official_price_per_bottle_twd,
    cashFloor: p.cash_floor_per_bottle_twd,
    giftEquivalentFloor: p.gift_equivalent_floor_per_bottle_twd,
    maxGifts: p.max_promo_gifts_per_order,
  }
}

const num = (v: unknown) => MathBN.convert((v ?? 0) as never).toNumber()

export const bottlesPerUnit = (sku: string) => Number(/-X(\d+)$/.exec(sku)?.[1] ?? 1)

export function orderShape(items: FloorItem[]) {
  let bottles = 0
  let cash = 0
  let giftUnits = 0
  let giftValue = 0
  for (const it of items) {
    if (it.total === undefined || it.total === null) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "line item totals are missing; cannot check the price rules")
    }
    const qty = num(it.quantity)
    const total = num(it.total)
    if (it.variant_sku?.startsWith(BOTTLE_SKU_PREFIX)) {
      bottles += qty * bottlesPerUnit(it.variant_sku)
      cash += total
    } else if (total <= 0.005 && num(it.unit_price) > 0) {
      giftUnits += qty
      giftValue += num(it.unit_price) * qty
    }
  }
  return { bottles, cash, giftUnits, giftValue }
}

const REFUSED = "優惠合併後超過本店的折扣上限，請移除一個優惠碼後再結帳。"

// 1 cent of slack for the rounding of discounts spread across lines.
export function checkPriceFloor(items: FloorItem[], policy: PricePolicy = pricePolicy()) {
  const { bottles, cash, giftUnits, giftValue } = orderShape(items)
  if (giftUnits > policy.maxGifts) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "每筆訂單最多一份贈品，請移除多的贈品後再結帳。")
  }
  if (bottles > 0 && cash < bottles * policy.cashFloor - 0.01) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, REFUSED)
  }
  if (giftUnits > 0 && cash < (bottles + giftValue / policy.officialPrice) * policy.giftEquivalentFloor - 0.01) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, REFUSED)
  }
}
