// [LINE-04] Webhook request body (Messaging API). Only the fields this project reads are typed;
// line-openapi webhook.yml (2026-10-15): CallbackRequest { destination, events[] }, every event
// carries type, mode ("active" | "standby"), timestamp, webhookEventId (ULID) and
// deliveryContext.isRedelivery; follow and message events carry a replyToken.
export type LineSource = {
  type: "user" | "group" | "room" | string
  userId?: string
  groupId?: string
  roomId?: string
}

export type LineWebhookEvent = {
  type: string
  mode?: "active" | "standby" | string
  timestamp?: number
  webhookEventId?: string
  deliveryContext?: { isRedelivery?: boolean }
  source?: LineSource
  replyToken?: string
  message?: { type: string; id?: string; text?: string }
}

export type LineCallbackBody = { destination?: string; events: LineWebhookEvent[] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Parses the VERIFIED raw body. Null when it is not JSON or has no events array; events that
 * are not objects with a string type are dropped.
 */
export function parseCallbackBody(raw: Buffer): LineCallbackBody | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString("utf8"))
  } catch {
    return null
  }
  if (!isObject(parsed) || !Array.isArray(parsed.events)) {
    return null
  }
  const events = parsed.events.filter(
    (e): e is LineWebhookEvent => isObject(e) && typeof e.type === "string"
  )
  return {
    destination: typeof parsed.destination === "string" ? parsed.destination : undefined,
    events,
  }
}
