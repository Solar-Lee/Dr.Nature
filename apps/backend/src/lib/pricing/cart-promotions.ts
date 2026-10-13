// [P5-04/P5-05 review fixes] Checks on the promotions a completing cart actually carries
// (discount adjustments with an amount, on items or shipping methods), run in the completeCart
// validate hook:
//  - still live (review promotions-2): completeCartWorkflow builds the order from the cart's
//    STORED adjustments and Medusa's registerUsage silently skips promotions that are no longer
//    active (status, or a campaign window that has ended), so an expired code would keep its
//    discount and not be counted against its limit or budget. Same rule as Medusa's
//    listActivePromotions_ (promotion 2.21.2 promotion-module.js:47-73; re-check on upgrades):
//    status "active" and, for campaign promotions, starts_at <= now < ends_at. Deleted promotions
//    are stale too. Exception: when ECPay already holds a verified code or payment for this
//    cart's session (the PaymentInfoURL / ReturnURL fallback completions), the amount was fixed
//    while the promotion was live and the shopper may already have paid it: the order is honoured
//    and staff are alerted ([PROMO-ALERT]) instead of leaving a payable code with no order.
//  - R2 (membership.md §6.1): 團主碼 / 首購禮 / 會員價 never share one order (metadata.drn_offer;
//    promotions without it count as "campaign").
//  - member price conditions (review promotions-6 / cross-3): only in
//    pricing.member_price_sales_channels and only for pricing.member_price_min_bottles bottles or
//    more (the template rule original_item_total >= 2,300 equals 2 bottles only when the cart
//    holds nothing else).
// Messages are for shoppers and never reveal internal numbers.
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN, MedusaError, Modules } from "@medusajs/framework/utils"
import { verifiedNoticeFor, verifiedPaymentInfoFor, verifiedTradeInfoFor } from "../ecpay/aio"
import { ECPAY_PROVIDER_ID, ecpayOptionsFromEnv } from "../ecpay/config"
import { loadTierConfig } from "../membership/config"
import { orderShape, type FloorItem } from "./price-floor"

type Adjustment = { promotion_id?: string | null; code?: string | null; amount?: unknown }
export type PromotionCart = {
  sales_channel_id?: string | null
  items?: (FloorItem & { adjustments?: Adjustment[] | null })[] | null
  shipping_methods?: { adjustments?: Adjustment[] | null }[] | null
  payment_collection?: { payment_sessions?: { id: string; provider_id?: string | null; data?: Record<string, unknown> | null }[] | null } | null
}

type PromotionRow = {
  id: string
  code?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
  campaign?: { starts_at?: string | Date | null; ends_at?: string | Date | null } | null
}

export const EXPIRED = "優惠已結束或已停用，請重新整理購物車後再結帳。"
export const EXCLUSIVE = "團主優惠碼、首購禮與會員價只能擇一，請移除其中一個優惠碼後再結帳。"
export const MEMBER_MIN_BOTTLES = "會員價需購買 2 瓶以上，請增加數量或移除會員價優惠碼。"
export const MEMBER_CHANNEL = "會員價僅限官網使用，請移除會員價優惠碼後再結帳。"

const num = (v: unknown) => MathBN.convert((v ?? 0) as never).toNumber()

// Promotions that actually discount this cart. promotion_id can be missing on an adjustment
// (Medusa sets it from a code lookup, prepare-adjustments-from-promotion-actions.js), so those are
// identified by code.
export function appliedPromotionRefs(cart: PromotionCart): { ids: string[]; codes: string[] } {
  const adjustments = [
    ...(cart.items ?? []).flatMap((i) => i.adjustments ?? []),
    ...(cart.shipping_methods ?? []).flatMap((m) => m.adjustments ?? []),
  ].filter((a) => num(a.amount) > 0)
  return {
    ids: [...new Set(adjustments.filter((a) => a.promotion_id).map((a) => a.promotion_id!))],
    codes: [...new Set(adjustments.filter((a) => !a.promotion_id && a.code).map((a) => a.code!))],
  }
}

// ECPay has issued a payable code, or taken the money, for one of the cart's sessions (verified
// signed proofs bound to the session, trade number and amount; planted data does not count).
export function ecpayAmountCommitted(cart: PromotionCart): boolean {
  let o: ReturnType<typeof ecpayOptionsFromEnv>
  try {
    o = ecpayOptionsFromEnv()
  } catch {
    return false
  }
  const creds = { merchantId: o.merchantId, hashKey: o.hashKey, hashIV: o.hashIV }
  return (cart.payment_collection?.payment_sessions ?? []).some((s) => {
    if (s.provider_id !== ECPAY_PROVIDER_ID) return false
    const d = s.data ?? {}
    const binding = { merchantTradeNo: String(d.merchant_trade_no ?? ""), sessionId: s.id, amount: Number(d.amount) }
    return !!(
      verifiedPaymentInfoFor(d.ecpay_payment_info, binding, creds) ||
      verifiedNoticeFor(d.ecpay_notice, binding, creds, o.acceptSimulatedPayments) ||
      verifiedTradeInfoFor(d.ecpay_trade_info, binding, creds)
    )
  })
}

export function isLive(p: PromotionRow, now: Date): boolean {
  if (p.status !== "active") return false
  const starts = p.campaign?.starts_at ? new Date(p.campaign.starts_at) : null
  const ends = p.campaign?.ends_at ? new Date(p.campaign.ends_at) : null
  return (!starts || starts <= now) && (!ends || ends > now)
}

export function exclusiveOfferProblem(offers: string[], exclusive: string[]): string | null {
  const used = [...new Set(offers.filter((o) => exclusive.includes(o)))]
  return used.length > 1 ? `exclusive offers combined: ${used.sort().join(" + ")}` : null
}

export async function checkCartPromotions(cart: PromotionCart, container: MedusaContainer, now: Date = new Date()) {
  const { ids, codes } = appliedPromotionRefs(cart)
  if (!ids.length && !codes.length) {
    return
  }
  const svc = container.resolve(Modules.PROMOTION)
  const select = { select: ["id", "code", "status", "metadata"], relations: ["campaign"] }
  const promotions = [
    ...(ids.length ? await svc.listPromotions({ id: ids }, select) : []),
    ...(codes.length ? await svc.listPromotions({ code: codes }, select) : []),
  ] as unknown as PromotionRow[]
  const missing = [...ids.filter((id) => !promotions.some((p) => p.id === id)), ...codes.filter((c) => !promotions.some((p) => p.code === c))]
  const stale = [...missing, ...promotions.filter((p) => !isLive(p, now)).map((p) => p.code ?? p.id)]
  if (stale.length) {
    if (!ecpayAmountCommitted(cart)) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, EXPIRED)
    }
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`[PROMO-ALERT] completing a cart whose ECPay code / payment was issued while ${stale.join(", ")} was live; the discount is honoured and not counted against its limit or budget (Medusa skips inactive promotions)`)
  }
  const c = loadTierConfig()
  const offers = promotions.map((p) => String(p.metadata?.drn_offer ?? "campaign"))
  if (exclusiveOfferProblem(offers, c.pricing.mutually_exclusive_offers)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, EXCLUSIVE)
  }
  if (offers.includes("member_price")) {
    if (orderShape(cart.items ?? []).bottles < c.pricing.member_price_min_bottles) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, MEMBER_MIN_BOTTLES)
    }
    const channels = await container
      .resolve(Modules.SALES_CHANNEL)
      .listSalesChannels({ name: c.pricing.member_price_sales_channels }, { select: ["id"] })
    if (!cart.sales_channel_id || !channels.some((ch) => ch.id === cart.sales_channel_id)) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, MEMBER_CHANNEL)
    }
  }
}
