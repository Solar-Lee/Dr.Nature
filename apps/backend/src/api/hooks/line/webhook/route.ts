// [LINE-04] LINE Messaging API webhook for the official account.
//  1. LINE_OA_CHANNEL_SECRET unset -> 503 (fail closed, nothing is parsed).
//  2. x-line-signature must be the HMAC-SHA256 of the RAW body (lib/line/signature.ts); the
//     route's body parser keeps the bytes (middlewares.ts: preserveRawBody). Anything else ->
//     401, logged as "signature rejected" with the client IP only (no body, no header value).
//  3. When LINE_OA_FORWARD_URL is set, the verified request (raw bytes, x-line-signature,
//     content-type) is forwarded to the group-buy bot without waiting (lib/line/forward.ts,
//     LINE-07, G3 option 3).
//  4. The verified bytes are parsed; events already seen (same webhookEventId, i.e. a
//     redelivery) are dropped.
//  5. 200 {} is sent BEFORE the events are handled: LINE's Verify button sends an empty
//     events array, and a failed or slow handler must not make LINE redeliver.
//  6. Each event goes to lib/line/dispatch.ts in its own try/catch (auto-replies, LINE-06).
// developers.line.biz/en/docs/messaging-api/verify-webhook-signature/, receiving-messages/.
// /hooks/* has no publishable-key, auth or CORS middleware in Medusa 2.21.2.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { RecentIds } from "../../../../lib/line/dedupe"
import { dispatchLineEvent } from "../../../../lib/line/dispatch"
import { parseCallbackBody } from "../../../../lib/line/events"
import { forwardLineWebhook } from "../../../../lib/line/forward"
import { lineClient, lineReplies } from "../../../../lib/line/runtime"
import { verifyLineSignature } from "../../../../lib/line/signature"

const recentEvents = new RecentIds(5000)

const text = (res: MedusaResponse, status: number, body: string) => res.status(status).type("text/plain").send(body)

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const secret = process.env.LINE_OA_CHANNEL_SECRET
  if (!secret) {
    logger.error("[LINE-WEBHOOK] called but LINE_OA_CHANNEL_SECRET is not set")
    return text(res, 503, "Not configured")
  }

  const raw: Buffer | undefined = Buffer.isBuffer(req.rawBody) ? req.rawBody : undefined
  const signature = req.headers["x-line-signature"]
  if (!verifyLineSignature(raw, secret, signature)) {
    logger.warn(`[LINE-WEBHOOK] signature rejected (client_ip=${req.ip ?? "-"})`)
    return text(res, 401, "Invalid signature")
  }

  // [LINE-07] Original bytes and headers to the group-buy bot; not awaited, never rejects.
  void forwardLineWebhook(
    { rawBody: raw as Buffer, signature: signature as string, contentType: req.headers["content-type"] },
    { logger }
  )

  const body = parseCallbackBody(raw as Buffer)
  if (!body) {
    logger.warn("[LINE-WEBHOOK] signed body without an events array")
    return text(res, 400, "Bad request")
  }

  const events = body.events.filter((e) => !e.webhookEventId || recentEvents.firstSeen(e.webhookEventId))
  const repeats = body.events.length - events.length
  if (repeats > 0) {
    logger.info(`[LINE-WEBHOOK] ${repeats} redelivered event(s) skipped`)
  }

  res.status(200).json({})

  const ctx = { logger, client: lineClient(logger), replies: lineReplies(logger) }
  for (const event of events) {
    try {
      await dispatchLineEvent(event, ctx)
    } catch (e) {
      logger.error(`[LINE-WEBHOOK] handler failed for ${event.type} ${event.webhookEventId ?? "-"}: ${(e as Error).message}`)
    }
  }
}
