// [P9-01] Settles an order's affiliate attribution once it is placed (docs/strategy/affiliate.md).
// completeCartWorkflow copies cart.metadata.affiliate onto the order before any project code can
// change it (its only hook, validate, cannot alter the order data), so the decision is taken
// here, against the order's created_at (the moment the cart became an order):
//  - genuine (store exists, same partner and slug) and the store was open then -> kept, with
//    verified_at;
//  - otherwise -> removed from metadata.affiliate and kept for the record under
//    metadata.affiliate_dropped { ...attribution, reason, dropped_at }. The order is untouched.
// The store's status and its partner's status are read when this runs (normally within seconds of
// placement); the window is checked exactly. Idempotent: a verified or dropped attribution is left
// alone. The GMV export (P9-03) re-checks the deterministic part, so a failure here never credits
// a closed store.
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ATTRIBUTION_KEY, DROPPED_KEY, attributionProblem, parseAttribution } from "../lib/affiliate/rules"
import { storesById } from "../lib/affiliate/store"

export default async function affiliateAttributionHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const orders = container.resolve(Modules.ORDER)
    const order = await orders.retrieveOrder(event.data.id, { select: ["id", "metadata", "created_at"] })
    const raw = order.metadata?.[ATTRIBUTION_KEY] as Record<string, unknown> | undefined
    if (raw === undefined || raw === null || (typeof raw === "object" && raw.verified_at)) {
      return
    }
    const att = parseAttribution(raw)
    const store = att ? (await storesById(container, [att.store_id])).get(att.store_id) : undefined
    const now = new Date()
    const problem = attributionProblem(raw, store, new Date(order.created_at))
    if (!problem) {
      await orders.updateOrders([{ id: order.id, metadata: { [ATTRIBUTION_KEY]: { ...att, verified_at: now.toISOString() } } }])
      return
    }
    await orders.updateOrders([
      {
        id: order.id,
        metadata: {
          [ATTRIBUTION_KEY]: "",
          [DROPPED_KEY]: { ...(typeof raw === "object" ? raw : { value: raw }), reason: problem, dropped_at: now.toISOString() },
        },
      },
    ])
    logger.info(`[affiliate] order ${order.id}: attribution dropped (${problem})`)
  } catch (e) {
    logger.error(`[AFFILIATE-ALERT] order ${event.data.id}: attribution not settled: ${(e as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "drn-affiliate-attribution" },
}
