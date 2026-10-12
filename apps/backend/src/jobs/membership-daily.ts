// [P5-03] Daily tier evaluation at 03:00 Asia/Taipei (19:00 UTC): upgrades once spend is
// confirmed (delivered + 10 days), and window-expiry downgrades on the monthly review day
// (membership.md §4). A proposal config never runs in production (engineBlockedReason).
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { engineBlockedReason, loadTierConfig } from "../lib/membership/config"
import { evaluateAllMembers } from "../lib/membership/engine"

export default async function membershipDailyJob(container: MedusaContainer) {
  // Tests call evaluateAllMembers directly with a chosen clock.
  if (process.env.NODE_ENV === "test") {
    return
  }
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const blocked = engineBlockedReason(loadTierConfig())
  if (blocked) {
    logger.warn(`[membership] daily evaluation skipped: ${blocked}`)
    return
  }
  await evaluateAllMembers(container)
}

export const config = {
  name: "drn-membership-daily",
  schedule: "0 19 * * *",
}
