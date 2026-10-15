// [LINE-04] POST /hooks/line/webhook: raw-body signature check, 503 / 401 / 200 semantics,
// redelivery de-duplication, nothing served on GET.
// [LINE-06] Auto-replies reach the Messaging API (a local stub on an OS-assigned port,
// LINE_OA_API_BASE_URL) with the content of src/data/line-replies.json (or the built-in replies
// while it is absent).
//
// What these tests cannot prove: that LINE's servers reach the URL (Cloudflare Access bypass
// and the webhook URL in the LINE Developers console are Aki's, LINE's Verify button is the
// live check), nor that the production channel secret is the right one.
//
// Run: cd apps/backend && ../../infra/test-env.sh env TEST_TYPE=integration:http \
//   NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --forceExit integration-tests/http/line-webhook.spec.ts
import http from "http"
import type { AddressInfo } from "net"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { planReply } from "../../src/lib/line/dispatch"
import { loadLineReplies } from "../../src/lib/line/replies"
import { lineSignature } from "../../src/lib/line/signature"

// Fake test value (not a real channel secret). Read per request by the route.
const SECRET = "line-oa-test-secret-not-real"
process.env.LINE_OA_CHANNEL_SECRET = SECRET

jest.setTimeout(120 * 1000)

const PATH = "/hooks/line/webhook"
let seq = 0
const eventId = () => `01JLINEWEBHOOKTEST${String(++seq).padStart(8, "0")}`

const textEvent = (id: string, text: string) => ({
  type: "message",
  mode: "active",
  timestamp: 1791820000000,
  source: { type: "user", userId: "U0000000000000000000000000000test" },
  webhookEventId: id,
  deliveryContext: { isRedelivery: false },
  replyToken: "reply-token-test",
  message: { type: "text", id: "1", text, quoteToken: "q" },
})

type StubCall = { path: string; headers: http.IncomingHttpHeaders; body: string }

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    // Plays api.line.me: token endpoint and reply endpoint. Port 0 = any free port.
    let stub: http.Server
    let stubCalls: StubCall[] = []
    let tokenRequests = 0 // whole file: the client keeps its token between webhooks
    beforeAll(async () => {
      stub = http.createServer((req, res) => {
        let body = ""
        req.setEncoding("utf8")
        req.on("data", (c) => (body += c))
        req.on("end", () => {
          stubCalls.push({ path: req.url ?? "", headers: req.headers, body })
          if (req.url === "/oauth2/v3/token") tokenRequests++
          res.writeHead(200, { "content-type": "application/json" })
          res.end(req.url === "/oauth2/v3/token" ? JSON.stringify({ access_token: "stub-token", expires_in: 900, token_type: "Bearer" }) : "{}")
        })
      })
      await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()))
      process.env.LINE_OA_CHANNEL_ID = "2000000000" // fake test value
      process.env.LINE_OA_API_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`
    })
    afterAll(async () => {
      delete process.env.LINE_OA_CHANNEL_ID
      delete process.env.LINE_OA_API_BASE_URL
      await new Promise((r) => stub.close(r))
    })
    beforeEach(() => {
      stubCalls = []
    })
    const replyCalls = () => stubCalls.filter((c) => c.path === "/v2/bot/message/reply")

    const post = (body: string | Buffer, signature?: string, contentType = "application/json; charset=utf-8") => {
      const headers: Record<string, string> = { "content-type": contentType }
      if (signature !== undefined) headers["x-line-signature"] = signature
      // A Buffer is sent byte for byte (axios trims and may re-serialize JSON strings).
      return api.post(PATH, Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8"), { headers, validateStatus: () => true })
    }
    const signed = (body: string) => post(body, lineSignature(body, SECRET))

    let info: jest.SpyInstance
    let warn: jest.SpyInstance
    beforeEach(() => {
      const logger = getContainer().resolve(ContainerRegistrationKeys.LOGGER)
      info = jest.spyOn(logger, "info")
      warn = jest.spyOn(logger, "warn")
    })
    afterEach(() => {
      info.mockRestore()
      warn.mockRestore()
    })
    const handledLines = (id: string) =>
      info.mock.calls.filter(([m]) => typeof m === "string" && m.startsWith("[LINE-WEBHOOK] event ") && m.endsWith(` ${id}`))
    // Events are handled after the 200 is sent.
    const settle = async () => {
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25))
    }

    it("answers 200 {} to a correctly signed body and hands each event to the dispatcher", async () => {
      const id = eventId()
      const res = await signed(JSON.stringify({ destination: "U0000000000000000000000000000bot1", events: [textEvent(id, "hello")] }))
      expect(res.status).toBe(200)
      expect(res.data).toEqual({})
      await settle()
      expect(handledLines(id)).toHaveLength(1)
    })

    it("answers 200 {} to LINE's Verify request (empty events)", async () => {
      const res = await signed('{"destination":"U0000000000000000000000000000bot1","events":[]}')
      expect(res.status).toBe(200)
      expect(res.data).toEqual({})
    })

    it("verifies the raw bytes: UTF-8 text, unicode escapes and whitespace that re-serializing would change", async () => {
      const id = eventId()
      // Pretty-printed with a \u escape (請) and a literal 運費: JSON.stringify(req.body) would differ.
      const body = `{\n  "destination": "U0000000000000000000000000000bot1",\n  "events": [${JSON.stringify(textEvent(id, "PLACEHOLDER")).replace("PLACEHOLDER", "\\u8acb問運費多少？ 🙂")}]\n}\n`
      expect(JSON.stringify(JSON.parse(body))).not.toBe(body)
      const res = await signed(body)
      expect(res.status).toBe(200)
      await settle()
      expect(handledLines(id)).toHaveLength(1)
    })

    it("rejects a body with one character changed after signing (401, nothing handled, nothing of the body logged)", async () => {
      const id = eventId()
      const body = JSON.stringify({ destination: "U0000000000000000000000000000bot1", events: [textEvent(id, "請問運費")] })
      const res = await post(body.replace("運費", "運送"), lineSignature(body, SECRET))
      expect(res.status).toBe(401)
      expect(res.data).toBe("Invalid signature")
      await settle()
      expect(handledLines(id)).toHaveLength(0)
      const logged = JSON.stringify(warn.mock.calls)
      expect(logged).toContain("[LINE-WEBHOOK] signature rejected")
      expect(logged).not.toContain("運")
      expect(logged).not.toContain(lineSignature(body, SECRET))
    })

    it("rejects a missing or malformed signature header (401)", async () => {
      const body = JSON.stringify({ destination: "U0000000000000000000000000000bot1", events: [] })
      expect((await post(body)).status).toBe(401)
      expect((await post(body, "")).status).toBe(401)
      expect((await post(body, "not-base64!")).status).toBe(401)
      expect((await post(body, lineSignature(body, "another-secret"))).status).toBe(401)
    })

    it("rejects a signed body the JSON parser did not keep (other content type)", async () => {
      const body = JSON.stringify({ destination: "U0000000000000000000000000000bot1", events: [] })
      const res = await post(body, lineSignature(body, SECRET), "text/csv")
      expect(res.status).toBe(401)
    })

    it("handles an event once when LINE redelivers the same webhookEventId", async () => {
      const id = eventId()
      const first = JSON.stringify({ destination: "U0000000000000000000000000000bot1", events: [textEvent(id, "退貨")] })
      const again = JSON.stringify({
        destination: "U0000000000000000000000000000bot1",
        events: [{ ...textEvent(id, "退貨"), deliveryContext: { isRedelivery: true } }],
      })
      expect((await signed(first)).status).toBe(200)
      expect((await signed(again)).status).toBe(200)
      await settle()
      expect(handledLines(id)).toHaveLength(1)
    })

    it("answers 503 when the channel secret is not configured", async () => {
      const body = JSON.stringify({ destination: "U0000000000000000000000000000bot1", events: [] })
      delete process.env.LINE_OA_CHANNEL_SECRET
      try {
        const res = await post(body, lineSignature(body, SECRET))
        expect(res.status).toBe(503)
      } finally {
        process.env.LINE_OA_CHANNEL_SECRET = SECRET
      }
    })

    it("replies through the Messaging API: greeting on follow, the planned reply to a text", async () => {
      const replies = loadLineReplies().replies
      const followId = eventId()
      const follow = {
        type: "follow",
        mode: "active",
        timestamp: 1791820000000,
        source: { type: "user", userId: "U0000000000000000000000000000test" },
        webhookEventId: followId,
        deliveryContext: { isRedelivery: false },
        replyToken: "reply-token-follow",
        follow: { isUnblocked: false },
      }
      const textId = eventId()
      const question = { ...textEvent(textId, "請問退貨怎麼辦"), replyToken: "reply-token-text" }
      const res = await signed(JSON.stringify({ destination: "U0000000000000000000000000000bot1", events: [follow, question] }))
      expect(res.status).toBe(200)
      for (let i = 0; i < 40 && replyCalls().length < 2; i++) await new Promise((r) => setTimeout(r, 25))

      expect(tokenRequests).toBe(1)
      const sent = replyCalls().map((c) => ({ auth: c.headers.authorization, body: JSON.parse(c.body) }))
      expect(sent).toEqual([
        { auth: "Bearer stub-token", body: { replyToken: "reply-token-follow", messages: planReply(follow, replies)?.messages } },
        { auth: "Bearer stub-token", body: { replyToken: "reply-token-text", messages: planReply(question, replies)?.messages } },
      ])
      expect(sent[0].body.messages[0].text).toBe(replies.greeting.text)
      for (const s of sent) expect(s.body.messages.length).toBeLessThanOrEqual(5)
    })

    it("does not reply in a group chat", async () => {
      const id = eventId()
      const inGroup = { ...textEvent(id, "請問運費"), source: { type: "group", groupId: "C0000000000000000000000000000grp", userId: "U0000000000000000000000000000test" } }
      expect((await signed(JSON.stringify({ destination: "U0000000000000000000000000000bot1", events: [inGroup] }))).status).toBe(200)
      await settle()
      expect(handledLines(id)).toHaveLength(1)
      expect(replyCalls()).toHaveLength(0)
    })

    it("serves nothing on GET", async () => {
      const res = await api.get(PATH, { validateStatus: () => true })
      expect(res.status).toBe(404)
    })
  },
})
