// [LINE-04] Hands each verified, de-duplicated webhook event to its handler.
// [LINE-06] Auto-replies (reply API, free of charge) from lib/line/replies.ts:
//  - follow                -> greeting
//  - text message          -> handoff text if a handoff keyword is present, else the intent
//                             with the longest matching keyword (reply text + quick replies),
//                             else fallback
//  - other message types   -> fallback
//  - anything else (unfollow, postback, join, ...) -> no reply
// Replies go only to one-to-one chats (source.type "user") in active mode: group and room
// messages are left to the group-buy bot that receives the forwarded webhook (G3 option 3,
// LINE-07), and a channel in standby mode must not answer. A reply token is single use.
// Logged: event type and id, and which reply kind was chosen; never the text or the user id.
import type { Logger } from "@medusajs/framework/types"
import type { LineMessage, LineQuickReplyItem } from "./client"
import type { LineWebhookEvent } from "./events"
import { BUILT_IN_REPLIES, matchReply, type LineReplies, type QuickReplyButton } from "./replies"

export type ReplySender = { reply(replyToken: string, messages: LineMessage[]): Promise<void> }

export type DispatchContext = {
  logger: Logger
  /** null when LINE_OA_CHANNEL_ID / LINE_OA_CHANNEL_SECRET are not set: nothing is sent. */
  client?: ReplySender | null
  replies?: LineReplies
}

export type PlannedReply = { kind: "greeting" | "handoff" | "fallback" | `intent:${string}`; messages: LineMessage[] }

const quickReply = (buttons: QuickReplyButton[]): { items: LineQuickReplyItem[] } | undefined =>
  buttons.length
    ? { items: buttons.map((b) => ({ type: "action", action: { type: "message", label: b.label, text: b.text } })) }
    : undefined

const textMessage = (text: string, buttons: QuickReplyButton[] = []): LineMessage => {
  const qr = quickReply(buttons)
  return qr ? { type: "text", text, quickReply: qr } : { type: "text", text }
}

/** What to answer to one event, or null for no reply. Pure. */
export function planReply(event: LineWebhookEvent, replies: LineReplies): PlannedReply | null {
  if (!event.replyToken || event.source?.type !== "user" || (event.mode && event.mode !== "active")) {
    return null
  }
  if (event.type === "follow") {
    return { kind: "greeting", messages: [textMessage(replies.greeting.text)] }
  }
  if (event.type !== "message") {
    return null
  }
  const text = event.message?.type === "text" && typeof event.message.text === "string" ? event.message.text : null
  const match = text === null ? ({ kind: "fallback" } as const) : matchReply(text, replies)
  switch (match.kind) {
    case "handoff":
      return { kind: "handoff", messages: [textMessage(replies.handoff.text)] }
    case "intent":
      return { kind: `intent:${match.intent.id}`, messages: [textMessage(match.intent.reply.text, match.intent.quickReplies)] }
    default:
      return { kind: "fallback", messages: [textMessage(replies.fallback.text)] }
  }
}

export async function dispatchLineEvent(event: LineWebhookEvent, ctx: DispatchContext): Promise<void> {
  const id = event.webhookEventId ?? "-"
  ctx.logger.info(`[LINE-WEBHOOK] event ${event.type} ${id}`)
  const plan = planReply(event, ctx.replies ?? BUILT_IN_REPLIES)
  if (!plan) {
    return
  }
  if (!ctx.client) {
    ctx.logger.warn(`[LINE-WEBHOOK] ${plan.kind} reply for ${id} not sent: LINE_OA_CHANNEL_ID / LINE_OA_CHANNEL_SECRET not set`)
    return
  }
  await ctx.client.reply(event.replyToken as string, plan.messages)
  ctx.logger.info(`[LINE-WEBHOOK] replied ${plan.kind} to ${id}`)
}
