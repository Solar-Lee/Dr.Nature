// [P5-05] Price floor: after every promotion, tier price and gift is stacked, the cash paid per
// bottle (tax inclusive, after discounts) must not fall below the floor. Proposal in
// docs/strategy/go-to-market.md §1 (會員 2 瓶以上每瓶 1,035 = 1,150 x 90%); pending Aki's
// approval (DEV_PLAN §6). Change the number here, in one place, with a commit.
// Counted: line items whose variant SKU starts with DN-PB- (the bottles, docs/product/
// sku-coding.md). Free bottles count as bottles (買二送一 of the same product lowers the
// average); gifts that are other products do not.
// Checked when the cart completes (src/workflows/hooks/complete-cart-validate.ts), so it also
// covers promotions created by hand in the admin, not only the templates.
import { MathBN, MedusaError } from "@medusajs/framework/utils"

export const PRICE_FLOOR = { skuPrefix: "DN-PB-", minUnitCashTwd: 1035 } as const

export type FloorItem = { variant_sku?: string | null; quantity?: unknown; total?: unknown }

const num = (v: unknown) => MathBN.convert((v ?? 0) as never).toNumber()

export function bottleCash(items: FloorItem[], skuPrefix: string = PRICE_FLOOR.skuPrefix) {
  let units = 0
  let cash = 0
  for (const it of items) {
    if (!it.variant_sku?.startsWith(skuPrefix)) {
      continue
    }
    if (it.total === undefined || it.total === null) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "line item totals are missing; cannot check the price floor")
    }
    units += num(it.quantity)
    cash += num(it.total)
  }
  return { units, cash }
}

export function checkPriceFloor(items: FloorItem[], floor: { skuPrefix: string; minUnitCashTwd: number } = PRICE_FLOOR) {
  const { units, cash } = bottleCash(items, floor.skuPrefix)
  // 1 cent of slack for the rounding of discounts spread across lines.
  if (units > 0 && cash < units * floor.minUnitCashTwd - 0.01) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "優惠合併後超過本店的折扣上限，請移除一個優惠碼後再結帳。")
  }
}
