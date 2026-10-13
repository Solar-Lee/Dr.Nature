// [P4-09 review, design H2] Canceled order -> look for an ECPay capture the cancel did not refund
// (an admin cancel racing a payment, lib/ecpay/cancel-race.ts). A subscriber, not a
// cancelOrderWorkflow hook: Medusa releases the workflow's grouped events only after it
// finished, so the cancel has committed, and a failing check cannot roll back a cancel staff
// already confirmed.
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { flagOpenCaptures, openCapturesOnCanceledOrder } from "../lib/ecpay/cancel-race"

export default async function ecpayCancelRaceHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  const tag = `ECPay cancel check ${event.data.id}`
  try {
    const open = await openCapturesOnCanceledOrder(container, event.data.id)
    await flagOpenCaptures(container, event.data.id, open, tag)
  } catch (e) {
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`${tag}: [ECPAY-ALERT] could not check for a capture after the cancel (${(e as Error).message}); check the order's ECPay payments manually`)
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
  context: { subscriberId: "drn-ecpay-cancel-race" },
}
