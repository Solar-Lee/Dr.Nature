import { readFileSync } from "fs"
import { join } from "path"
import type { Logger } from "@medusajs/framework/types"
import type { LineMessage } from "../client"
import { dispatchLineEvent, planReply } from "../dispatch"
import type { LineWebhookEvent } from "../events"
import { BUILT_IN_REPLIES, parseLineReplies } from "../replies"

const replies = parseLineReplies(JSON.parse(readFileSync(join(__dirname, "fixtures/line-replies.fixture.json"), "utf8")))
const USER_ID = "U0000000000000000000000000000user"

const event = (over: Partial<LineWebhookEvent>): LineWebhookEvent => ({
  type: "message",
  mode: "active",
  webhookEventId: "01JDISPATCHTEST0000000000",
  replyToken: "reply-token",
  source: { type: "user", userId: USER_ID },
  ...over,
})
const text = (t: string) => event({ message: { type: "text", id: "1", text: t } })

const fakeLogger = () => {
  const lines: string[] = []
  const log = (m: string) => lines.push(m)
  return { lines, logger: { info: log, warn: log, error: log, debug: log } as unknown as Logger }
}
const fakeClient = () => {
  const sent: { replyToken: string; messages: LineMessage[] }[] = []
  return { sent, reply: async (replyToken: string, messages: LineMessage[]) => void sent.push({ replyToken, messages }) }
}

describe("planReply", () => {
  it("greets a new friend", () => {
    expect(planReply(event({ type: "follow" }), replies)).toEqual({ kind: "greeting", messages: [{ type: "text", text: "fixture greeting" }] })
  })

  it("answers a matched intent with its text and quick replies", () => {
    expect(planReply(text("運費多少"), replies)).toEqual({
      kind: "intent:shipping",
      messages: [
        {
          type: "text",
          text: "fixture shipping",
          quickReply: {
            items: [
              { type: "action", action: { type: "message", label: "退換貨", text: "退貨" } },
              { type: "action", action: { type: "message", label: "真人客服", text: "真人" } },
            ],
          },
        },
      ],
    })
  })

  it("leaves quickReply out when the intent has no buttons", () => {
    expect(planReply(text("退貨"), replies)?.messages).toEqual([{ type: "text", text: "fixture returns" }])
  })

  it("answers handoff and fallback", () => {
    expect(planReply(text("我要真人"), replies)).toEqual({ kind: "handoff", messages: [{ type: "text", text: "fixture handoff" }] })
    expect(planReply(text("你好"), replies)).toEqual({ kind: "fallback", messages: [{ type: "text", text: "fixture fallback" }] })
  })

  it("answers non-text messages with the fallback", () => {
    expect(planReply(event({ message: { type: "sticker", id: "2" } }), replies)?.kind).toBe("fallback")
  })

  it("never sends more than one message", () => {
    for (const e of [event({ type: "follow" }), text("運費"), text("真人"), text("x")]) {
      expect(planReply(e, replies)?.messages).toHaveLength(1)
    }
  })

  it("does not answer other event types, groups, rooms, standby mode or events without a reply token", () => {
    expect(planReply(event({ type: "unfollow", replyToken: undefined }), replies)).toBeNull()
    expect(planReply(event({ type: "postback" }), replies)).toBeNull()
    expect(planReply({ ...text("運費"), source: { type: "group", groupId: "C1", userId: USER_ID } }, replies)).toBeNull()
    expect(planReply({ ...text("運費"), source: { type: "room", roomId: "R1" } }, replies)).toBeNull()
    expect(planReply({ ...text("運費"), mode: "standby" }, replies)).toBeNull()
    expect(planReply({ ...text("運費"), replyToken: undefined }, replies)).toBeNull()
  })
})

describe("dispatchLineEvent", () => {
  it("replies with the reply token and logs the kind, never the text or the user id", async () => {
    const { lines, logger } = fakeLogger()
    const client = fakeClient()
    await dispatchLineEvent(text("請問運費"), { logger, client, replies })
    expect(client.sent).toEqual([{ replyToken: "reply-token", messages: expect.any(Array) }])
    expect(client.sent[0].messages[0]).toMatchObject({ text: "fixture shipping" })
    expect(lines).toEqual(["[LINE-WEBHOOK] event message 01JDISPATCHTEST0000000000", "[LINE-WEBHOOK] replied intent:shipping to 01JDISPATCHTEST0000000000"])
    expect(lines.join()).not.toContain("運費")
    expect(lines.join()).not.toContain(USER_ID)
  })

  it("uses the built-in replies when none are given", async () => {
    const { logger } = fakeLogger()
    const client = fakeClient()
    await dispatchLineEvent(event({ type: "follow" }), { logger, client })
    expect(client.sent[0].messages).toEqual([{ type: "text", text: BUILT_IN_REPLIES.greeting.text }])
  })

  it("sends nothing without a client and says why", async () => {
    const { lines, logger } = fakeLogger()
    await dispatchLineEvent(text("運費"), { logger, client: null, replies })
    expect(lines[1]).toBe("[LINE-WEBHOOK] intent:shipping reply for 01JDISPATCHTEST0000000000 not sent: LINE_OA_CHANNEL_ID / LINE_OA_CHANNEL_SECRET not set")
  })

  it("passes a failed reply on to the caller", async () => {
    const { logger } = fakeLogger()
    const client = { reply: async () => Promise.reject(new Error("LINE reply failed: 400 Invalid reply token")) }
    await expect(dispatchLineEvent(text("運費"), { logger, client, replies })).rejects.toThrow("Invalid reply token")
  })
})

describe("built-in replies", () => {
  it("greet, fall back and hand off to a person with 真人", () => {
    expect(planReply(event({ type: "follow" }), BUILT_IN_REPLIES)?.messages[0]).toMatchObject({ text: "您好，這裡是 Dr.Nature。想問訂單、出貨或標示上的內容，直接回覆即可。" })
    expect(planReply(text("運費"), BUILT_IN_REPLIES)?.messages[0]).toMatchObject({ text: "收到。這題我們請同事確認後回覆您；也可以回覆「真人」轉接。" })
    expect(planReply(text("真人"), BUILT_IN_REPLIES)?.kind).toBe("handoff")
  })
})
