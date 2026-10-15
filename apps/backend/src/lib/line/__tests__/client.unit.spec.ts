import { LineApiError, LineMessagingClient, userIdHash, type FetchLike, type LineMessage } from "../client"
import { assertLineOaEnv, lineOaClientSettingsFromEnv } from "../config"

// Fake test values (not real credentials).
const SETTINGS = { channelId: "2000000000", channelSecret: "oa-test-secret-not-real", apiBaseUrl: "http://line.test" }
const USER = "U0000000000000000000000000000user"

type Call = { url: string; headers: Record<string, string>; body: string }
type Reply = { status: number; body?: unknown } | Error

// A fetch double that plays LINE: answers the token endpoint with a fresh token per call and
// other endpoints from a queue (default 200 {}).
function lineDouble(queue: Reply[] = []) {
  const calls: Call[] = []
  let issued = 0
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body })
    const path = new URL(url).pathname
    const next: Reply =
      path === "/oauth2/v3/token" ? { status: 200, body: { access_token: `tok-${++issued}`, expires_in: 900, token_type: "Bearer" } } : queue.shift() ?? { status: 200, body: {} }
    if (next instanceof Error) throw next
    return { status: next.status, text: async () => JSON.stringify(next.body ?? {}) }
  }
  const at = (path: string) => calls.filter((c) => new URL(c.url).pathname === path)
  return { fetch, calls, at, issued: () => issued }
}

const text = (t: string): LineMessage => ({ type: "text", text: t })

describe("LineMessagingClient token", () => {
  it("issues a stateless token with client_credentials", async () => {
    const line = lineDouble()
    await new LineMessagingClient(SETTINGS, { fetch: line.fetch }).reply("rt", [text("hi")])
    const [token] = line.at("/oauth2/v3/token")
    expect(token.url).toBe("http://line.test/oauth2/v3/token")
    expect(token.headers["content-type"]).toBe("application/x-www-form-urlencoded")
    expect(Object.fromEntries(new URLSearchParams(token.body))).toEqual({
      grant_type: "client_credentials",
      client_id: SETTINGS.channelId,
      client_secret: SETTINGS.channelSecret,
    })
    expect(line.at("/v2/bot/message/reply")[0].headers.authorization).toBe("Bearer tok-1")
  })

  it("issues the token once and reuses it while valid, also for concurrent calls", async () => {
    const line = lineDouble()
    const client = new LineMessagingClient(SETTINGS, { fetch: line.fetch })
    await Promise.all([client.reply("a", [text("1")]), client.reply("b", [text("2")]), client.push(USER, [text("3")])])
    await client.reply("c", [text("4")])
    expect(line.issued()).toBe(1)
    expect(line.at("/v2/bot/message/reply").map((c) => c.headers.authorization)).toEqual(["Bearer tok-1", "Bearer tok-1", "Bearer tok-1"])
  })

  it("issues a new token 60 s before the old one expires", async () => {
    const line = lineDouble()
    let now = 1_000_000
    const client = new LineMessagingClient(SETTINGS, { fetch: line.fetch, now: () => now })
    await client.reply("a", [text("1")])
    now += (900 - 61) * 1000
    await client.reply("b", [text("2")])
    expect(line.issued()).toBe(1)
    now += 2000
    await client.reply("c", [text("3")])
    expect(line.issued()).toBe(2)
    expect(line.at("/v2/bot/message/reply")[2].headers.authorization).toBe("Bearer tok-2")
  })

  it("drops the token after a 401 so the next call issues a new one", async () => {
    const line = lineDouble([{ status: 401, body: { message: "Authentication failed" } }])
    const client = new LineMessagingClient(SETTINGS, { fetch: line.fetch })
    await expect(client.reply("a", [text("1")])).rejects.toThrow("LINE reply failed: 401 Authentication failed")
    await client.reply("b", [text("2")])
    expect(line.issued()).toBe(2)
  })

  it("reports a refused token request with status and LINE's message only", async () => {
    const calls: string[] = []
    const fetch: FetchLike = async (url) => {
      calls.push(url)
      return { status: 400, text: async () => JSON.stringify({ error: "invalid_client", message: "invalid client" }) }
    }
    const err = await new LineMessagingClient(SETTINGS, { fetch }).reply("rt", [text("hi")]).catch((e) => e)
    expect(err).toBeInstanceOf(LineApiError)
    expect(err.status).toBe(400)
    expect(err.message).not.toContain(SETTINGS.channelSecret)
    expect(calls).toHaveLength(1) // nothing sent without a token
  })
})

describe("LineMessagingClient reply", () => {
  it("posts replyToken and messages to /v2/bot/message/reply", async () => {
    const line = lineDouble()
    const msg: LineMessage = { type: "text", text: "您好", quickReply: { items: [{ type: "action", action: { type: "message", label: "運送", text: "運送" } }] } }
    await new LineMessagingClient(SETTINGS, { fetch: line.fetch }).reply("reply-token-1", [msg])
    const [call] = line.at("/v2/bot/message/reply")
    expect(call.headers["content-type"]).toBe("application/json")
    expect(JSON.parse(call.body)).toEqual({ replyToken: "reply-token-1", messages: [msg] })
  })

  it("refuses more than 5 or no messages before calling LINE", async () => {
    const line = lineDouble()
    const client = new LineMessagingClient(SETTINGS, { fetch: line.fetch })
    await expect(client.reply("rt", Array.from({ length: 6 }, (_, i) => text(String(i))))).rejects.toThrow(/LINE accepts 1-5 messages per request/)
    await expect(client.reply("rt", [])).rejects.toThrow(/LINE accepts 1-5 messages per request/)
    await expect(client.push(USER, Array.from({ length: 6 }, (_, i) => text(String(i))))).rejects.toThrow(/LINE accepts 1-5 messages per request/)
    expect(line.calls).toHaveLength(0)
  })

  it("does not retry a failed reply and keeps the token out of the error", async () => {
    const line = lineDouble([{ status: 500, body: { message: "Internal error" } }])
    const err = await new LineMessagingClient(SETTINGS, { fetch: line.fetch }).reply("rt", [text("hi")]).catch((e) => e)
    expect(err).toBeInstanceOf(LineApiError)
    expect(err.message).toBe("LINE reply failed: 500 Internal error")
    expect(err.message).not.toContain("tok-1")
    expect(line.at("/v2/bot/message/reply")).toHaveLength(1)
  })
})

describe("LineMessagingClient push", () => {
  it("sends X-Line-Retry-Key and logs a hash of the user id, never the id", async () => {
    const line = lineDouble()
    const logs: string[] = []
    const res = await new LineMessagingClient(SETTINGS, { fetch: line.fetch, logger: { info: (m) => logs.push(m) } }).push(USER, [text("1"), text("2")])
    const [call] = line.at("/v2/bot/message/push")
    expect(call.headers["x-line-retry-key"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(call.headers["x-line-retry-key"]).toBe(res.retryKey)
    expect(JSON.parse(call.body)).toEqual({ to: USER, messages: [text("1"), text("2")] })
    expect(res.outcome).toBe("sent")
    expect(logs).toEqual([`[LINE-PUSH] userId_hash=${userIdHash(USER)} count=2`])
    expect(logs.join()).not.toContain(USER)
  })

  it("retries a 500 once with the same retry key", async () => {
    const line = lineDouble([{ status: 500, body: { message: "Internal error" } }, { status: 200, body: {} }])
    const res = await new LineMessagingClient(SETTINGS, { fetch: line.fetch }).push(USER, [text("1")], "123e4567-e89b-12d3-a456-426614174000")
    const keys = line.at("/v2/bot/message/push").map((c) => c.headers["x-line-retry-key"])
    expect(keys).toEqual(["123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174000"])
    expect(res.outcome).toBe("sent")
  })

  it("retries a network failure once with the same retry key", async () => {
    const line = lineDouble([new TypeError("fetch failed"), { status: 200, body: {} }])
    const res = await new LineMessagingClient(SETTINGS, { fetch: line.fetch }).push(USER, [text("1")])
    const keys = line.at("/v2/bot/message/push").map((c) => c.headers["x-line-retry-key"])
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(res.outcome).toBe("sent")
  })

  it("treats 409 (retry key already accepted) as delivered", async () => {
    const line = lineDouble([{ status: 409, body: { message: "The retry key is already accepted" } }])
    const res = await new LineMessagingClient(SETTINGS, { fetch: line.fetch }).push(USER, [text("1")])
    expect(res.outcome).toBe("already-accepted")
    expect(line.at("/v2/bot/message/push")).toHaveLength(1)
  })

  it("does not retry other 4xx and fails after a second 500", async () => {
    const bad = lineDouble([{ status: 400, body: { message: "The request body has 1 error(s)" } }])
    await expect(new LineMessagingClient(SETTINGS, { fetch: bad.fetch }).push(USER, [text("1")])).rejects.toThrow("LINE push failed: 400 The request body has 1 error(s)")
    expect(bad.at("/v2/bot/message/push")).toHaveLength(1)
    const down = lineDouble([{ status: 500 }, { status: 500 }])
    await expect(new LineMessagingClient(SETTINGS, { fetch: down.fetch }).push(USER, [text("1")])).rejects.toThrow("LINE push failed: 500")
    expect(down.at("/v2/bot/message/push")).toHaveLength(2)
  })
})

describe("LINE OA settings from the environment", () => {
  it("needs both the channel ID and the secret", () => {
    expect(lineOaClientSettingsFromEnv({ NODE_ENV: "production" })).toBeNull()
    expect(lineOaClientSettingsFromEnv({ LINE_OA_CHANNEL_ID: "1", NODE_ENV: "production" })).toBeNull()
    expect(lineOaClientSettingsFromEnv({ LINE_OA_CHANNEL_SECRET: "s", NODE_ENV: "production" })).toBeNull()
    expect(lineOaClientSettingsFromEnv({ LINE_OA_CHANNEL_ID: "1", LINE_OA_CHANNEL_SECRET: "s", NODE_ENV: "production" })).toEqual({
      channelId: "1",
      channelSecret: "s",
      apiBaseUrl: "https://api.line.me",
    })
  })

  it("uses LINE_OA_API_BASE_URL outside production and refuses it in production", () => {
    const env = { LINE_OA_CHANNEL_ID: "1", LINE_OA_CHANNEL_SECRET: "s", LINE_OA_API_BASE_URL: "http://127.0.0.1:9/" }
    expect(lineOaClientSettingsFromEnv({ ...env, NODE_ENV: "test" })?.apiBaseUrl).toBe("http://127.0.0.1:9")
    expect(() => assertLineOaEnv({ ...env, NODE_ENV: "production" })).toThrow("LINE_OA_API_BASE_URL must not be set in production")
    expect(() => lineOaClientSettingsFromEnv({ ...env, NODE_ENV: "production" })).toThrow()
    expect(() => assertLineOaEnv({ NODE_ENV: "production" })).not.toThrow()
  })
})
