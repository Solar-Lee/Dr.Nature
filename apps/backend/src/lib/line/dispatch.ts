// [LINE-04] Hands each verified, de-duplicated webhook event to its handler. This task only
// records the event type and id (never the text or the user id); replies come with LINE-06.
import type { Logger } from "@medusajs/framework/types"
import type { LineWebhookEvent } from "./events"

export type DispatchContext = { logger: Logger }

export async function dispatchLineEvent(event: LineWebhookEvent, ctx: DispatchContext): Promise<void> {
  ctx.logger.info(`[LINE-WEBHOOK] event ${event.type} ${event.webhookEventId ?? "-"}`)
}
