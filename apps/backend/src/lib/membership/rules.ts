// [P5-03] Pure membership rules (docs/strategy/membership.md §3, §4, §10.1).
//  - An order counts with paid_total - refunded_total (transactions, not total), tax inclusive.
//  - Window: payment captured within rolling_window_days before now.
//  - Confirmed only after the 7-day right of withdrawal (消保法 §19) plus buffer: every live
//    shipment delivered and the last delivery confirm_after_delivered_days ago; without a
//    complete delivery record, confirm_fallback_after_payment_days after payment.
//  - Canceled orders and other sales channels never count.
//  - Upgrade at once; a lower tier is applied at once after a refund or cancel, otherwise
//    only on the monthly review day (Asia/Taipei).
import type { Tier, TierConfig } from "./config"

const DAY = 24 * 3600 * 1000

export type SpendOrder = {
  id: string
  status: string
  sales_channel_id: string | null
  captured_at: Date | null
  paid_total: number
  refunded_total: number
  // delivered_at of every fulfillment that is not canceled (null = not delivered yet)
  deliveries: (Date | null)[]
}

export type Contribution = { kind: "confirmed" | "pending" | "excluded"; amount: number; reason: string }

export function orderContribution(o: SpendOrder, c: TierConfig, channelIds: Set<string>, now: Date): Contribution {
  if (c.spend.exclude_canceled_orders && o.status === "canceled") {
    return { kind: "excluded", amount: 0, reason: "canceled" }
  }
  if (!o.sales_channel_id || !channelIds.has(o.sales_channel_id)) {
    return { kind: "excluded", amount: 0, reason: "sales channel" }
  }
  if (!o.captured_at) {
    return { kind: "excluded", amount: 0, reason: "not paid" }
  }
  if (o.captured_at.getTime() <= now.getTime() - c.spend.rolling_window_days * DAY) {
    return { kind: "excluded", amount: 0, reason: "outside window" }
  }
  const amount = o.paid_total - o.refunded_total
  if (amount <= 0) {
    return { kind: "excluded", amount: 0, reason: "fully refunded" }
  }
  const delivered = o.deliveries.length > 0 && o.deliveries.every((d) => d !== null)
  if (delivered) {
    const last = Math.max(...o.deliveries.map((d) => d!.getTime()))
    return last + c.spend.confirm_after_delivered_days * DAY <= now.getTime()
      ? { kind: "confirmed", amount, reason: "delivered + cooling-off" }
      : { kind: "pending", amount, reason: "cooling-off" }
  }
  return o.captured_at.getTime() + c.spend.confirm_fallback_after_payment_days * DAY <= now.getTime()
    ? { kind: "confirmed", amount, reason: "no delivery record, payment fallback" }
    : { kind: "pending", amount, reason: "not delivered" }
}

export function spendOf(orders: SpendOrder[], c: TierConfig, channelIds: Set<string>, now: Date) {
  let confirmed = 0
  let pending = 0
  for (const o of orders) {
    const r = orderContribution(o, c, channelIds, now)
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
export const taipeiDayOfMonth = (now: Date) => new Date(now.getTime() + 8 * 3600 * 1000).getUTCDate()

export type Reason = "daily" | "refund" | "cancel"

export function decideTier(
  c: TierConfig,
  currentCode: string,
  spend: number,
  reason: Reason,
  now: Date
): { code: string; change: "up" | "down" | "none" | "held" } {
  const computed = tierForSpend(c, spend).code
  const from = rank(c, currentCode)
  const to = rank(c, computed)
  if (to > from) {
    return { code: computed, change: "up" }
  }
  if (to === from) {
    return { code: c.tiers[from].code, change: "none" }
  }
  if (reason !== "daily" || taipeiDayOfMonth(now) === c.schedule.downgrade_review_day_of_month) {
    return { code: computed, change: "down" }
  }
  return { code: c.tiers[from].code, change: "held" }
}
