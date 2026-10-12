// [P5-03] Refund or cancellation -> recompute that member's tier at once; a lower tier applies
// immediately (membership.md §4.3). Upgrades and window expiry are the daily job's work
// (jobs/membership-daily.ts): spend counts only after delivery + cooling-off, which no event marks.
//  - payment.refunded { id: payment id }
//  - order.canceled { id: order id }
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { engineBlockedReason, loadTierConfig } from "../lib/membership/config"
import { recomputeCustomerTier } from "../lib/membership/engine"

export default async function membershipRecomputeHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    if (engineBlockedReason(loadTierConfig())) {
      return
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    let customerId: string | undefined
    if (event.name === "payment.refunded") {
      const { data } = await query.graph({ entity: "payment", fields: ["payment_collection.order.customer_id"], filters: { id: event.data.id } })
      customerId = (data[0] as { payment_collection?: { order?: { customer_id?: string | null } | null } | null } | undefined)?.payment_collection?.order
        ?.customer_id ?? undefined
    } else {
      const { data } = await query.graph({ entity: "order", fields: ["customer_id"], filters: { id: event.data.id } })
      customerId = (data[0] as { customer_id?: string | null } | undefined)?.customer_id ?? undefined
    }
    if (!customerId) {
      return
    }
    const r = await recomputeCustomerTier(container, customerId, event.name === "payment.refunded" ? "refund" : "cancel")
    if (r.change === "down" || r.change === "up") {
      logger.info(`[membership] ${event.name} ${event.data.id}: customer ${customerId} ${r.from} -> ${r.to}`)
    }
  } catch (e) {
    logger.error(`[MEMBERSHIP-ALERT] ${event.name} ${event.data.id}: tier recompute failed: ${(e as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: ["payment.refunded", "order.canceled"],
  context: { subscriberId: "drn-membership-recompute" },
}
