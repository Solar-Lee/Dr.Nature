// [P5-03] Pure membership rules (docs/strategy/membership.md §3, §4, §10.1).
//  - An order counts with paid_total - refunded_total (transactions, not total), tax inclusive.
//  - Window: payment captured within rolling_window_days before the window end.
//  - Confirmed only after the 7-day right of withdrawal (消保法 §19) plus buffer: every item
//    fulfilled, every live shipment delivered and the last delivery confirm_after_delivered_days
//    ago; otherwise confirm_fallback_after_payment_days after payment.
//  - Canceled orders and other sales channels never count.
//  - Tier decision (the same rule for the daily job and the refund/cancel subscriber, so a missed
//    event or a missed day heals on the next run):
//      up   when spend now reaches a higher tier;
//      down to the tier for spend measured with the window anchored at the LATEST monthly review
//           instant (Asia/Taipei 00:00 on downgrade_review_day_of_month). Refunds and cancels
//           lower that spend at once (money not received); orders that only left the 12-month
//           window still count until the next review day (§4.3 row 2);
//      held when spend now is below the current tier but the review-anchored spend is not.
import type { Tier, TierConfig } from "./config"

const DAY = 24 * 3600 * 1000
const TAIPEI_OFFSET = 8 * 3600 * 1000

export type SpendOrder = {
  id: string
  status: string
  sales_channel_id: string | null
  captured_at: Date | null
  paid_total: number
  refunded_total: number
  // every ordered unit has been put on a fulfillment (partial fulfillments wait)
  all_items_fulfilled: boolean
  // delivered_at of every fulfillment that is not canceled (null = not delivered yet)
  deliveries: (Date | null)[]
}

export type Contribution = { kind: "confirmed" | "pending" | "excluded"; amount: number; reason: string }

// windowStart: payments captured at or before it are outside the window (default: now - window).
export function orderContribution(
  o: SpendOrder,
  c: TierConfig,
  channelIds: Set<string>,
  now: Date,
  windowStart: Date = new Date(now.getTime() - c.spend.rolling_window_days * DAY)
): Contribution {
  if (c.spend.exclude_canceled_orders && o.status === "canceled") {
    return { kind: "excluded", amount: 0, reason: "canceled" }
  }
  if (!o.sales_channel_id || !channelIds.has(o.sales_channel_id)) {
    return { kind: "excluded", amount: 0, reason: "sales channel" }
  }
  if (!o.captured_at) {
    return { kind: "excluded", amount: 0, reason: "not paid" }
  }
  if (o.captured_at.getTime() <= windowStart.getTime()) {
    return { kind: "excluded", amount: 0, reason: "outside window" }
  }
  const amount = o.paid_total - o.refunded_total
  if (amount <= 0) {
    return { kind: "excluded", amount: 0, reason: "fully refunded" }
  }
  const delivered = o.all_items_fulfilled && o.deliveries.length > 0 && o.deliveries.every((d) => d !== null)
  if (delivered) {
    const last = Math.max(...o.deliveries.map((d) => d!.getTime()))
    return last + c.spend.confirm_after_delivered_days * DAY <= now.getTime()
      ? { kind: "confirmed", amount, reason: "delivered + cooling-off" }
      : { kind: "pending", amount, reason: "cooling-off" }
  }
  return o.captured_at.getTime() + c.spend.confirm_fallback_after_payment_days * DAY <= now.getTime()
    ? { kind: "confirmed", amount, reason: "no complete delivery record, payment fallback" }
    : { kind: "pending", amount, reason: "not delivered" }
}

export function spendOf(orders: SpendOrder[], c: TierConfig, channelIds: Set<string>, now: Date, windowStart?: Date) {
  let confirmed = 0
  let pending = 0
  for (const o of orders) {
    const r = orderContribution(o, c, channelIds, now, windowStart)
    if (r.kind === "confirmed") confirmed += r.amount
    if (r.kind === "pending") pending += r.amount
  }
  return { confirmed, pending }
}

export function tierForSpend(c: TierConfig, spend: number): Tier {
  return [...c.tiers].reverse().find((t) => spend >= t.min_spend_twd_12m) ?? c.tiers[0]
}

const rank = (c: TierConfig, code: string) => {
  const i = c.tiers.findIndex((t) => t.code === code)
  return i < 0 ? 0 : i
}

// Calendar day in Asia/Taipei (UTC+8, no daylight saving).
export const taipeiDayOfMonth = (now: Date) => new Date(now.getTime() + TAIPEI_OFFSET).getUTCDate()

// The latest monthly review instant at or before `now`: 00:00 Asia/Taipei on reviewDay.
export function latestReviewInstant(now: Date, reviewDay: number): Date {
  const t = new Date(now.getTime() + TAIPEI_OFFSET) // Taipei wall clock in UTC fields
  let y = t.getUTCFullYear()
  let m = t.getUTCMonth()
  if (t.getUTCDate() < reviewDay) {
    m -= 1
    if (m < 0) {
      m = 11
      y -= 1
    }
  }
  return new Date(Date.UTC(y, m, reviewDay) - TAIPEI_OFFSET)
}

// Window start for the review-anchored spend.
export const reviewWindowStart = (c: TierConfig, now: Date) =>
  new Date(latestReviewInstant(now, c.schedule.downgrade_review_day_of_month).getTime() - c.spend.rolling_window_days * DAY)

export type Reason = "daily" | "refund" | "cancel"

export function decideTier(
  c: TierConfig,
  currentCode: string,
  spendNow: number,
  spendAtReview: number
): { code: string; change: "up" | "down" | "none" | "held" } {
  const from = rank(c, currentCode)
  const nowTier = tierForSpend(c, spendNow).code
  if (rank(c, nowTier) > from) {
    return { code: nowTier, change: "up" }
  }
  const reviewTier = tierForSpend(c, spendAtReview).code
  if (rank(c, reviewTier) < from) {
    return { code: reviewTier, change: "down" }
  }
  if (rank(c, nowTier) < from) {
    return { code: c.tiers[from].code, change: "held" }
  }
  return { code: c.tiers[from].code, change: "none" }
}
