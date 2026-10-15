// [LINE-05] LINE Messaging API client: stateless channel access token, reply, push.
//  - Token: POST {base}/oauth2/v3/token, application/x-www-form-urlencoded,
//    grant_type=client_credentials & client_id & client_secret -> { access_token, expires_in,
//    token_type } (line-openapi channel-access-token.yml, issueStatelessChannelToken). Stateless
//    tokens last 15 minutes, cannot be revoked and have no issue limit
//    (developers.line.biz/en/docs/basics/channel-access-token/). Kept in memory until 60 s
//    before expiry; concurrent callers share one request; a 401 from LINE drops it.
//  - reply: POST {base}/v2/bot/message/reply { replyToken, messages (1-5) }. Free of charge; the
//    reply token is single use, so a failed reply is NOT retried.
//  - push: POST {base}/v2/bot/message/push { to, messages (1-5) } with X-Line-Retry-Key (a UUID
//    we generate). A 500 or a network error / timeout is retried ONCE with the same key; 409 means
//    LINE already accepted that key; other 4xx are not retried
//    (developers.line.biz/en/docs/messaging-api/retrying-api-request/). Pushes are billed against
//    the plan's monthly quota, so each one is logged as [LINE-PUSH] with a hash of the user id.
// Errors carry the HTTP status and LINE's own error message only: never the token, the secret,
// the user id or the message text.
import { createHash, randomUUID } from "crypto"
import { MedusaError } from "@medusajs/framework/utils"
import type { LineOaClientSettings } from "./config"

export type LineQuickReplyItem = {
  type: "action"
  action: { type: "message"; label: string; text: string }
}
export type LineTextMessage = { type: "text"; text: string; quickReply?: { items: LineQuickReplyItem[] } }
export type LineMessage = LineTextMessage

type FetchResponse = { status: number; text(): Promise<string> }
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<FetchResponse>

type InfoLogger = { info(message: string): void }

export type LineClientDeps = {
  fetch?: FetchLike
  now?: () => number
  logger?: InfoLogger
  timeoutMs?: number
}

export const MAX_MESSAGES_PER_REQUEST = 5
const TOKEN_EARLY_REFRESH_MS = 60_000

export class LineApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "LineApiError"
  }
}

const lineMessageOf = (raw: string) => {
  try {
    const m = (JSON.parse(raw) as { message?: unknown }).message
    return typeof m === "string" ? m : ""
  } catch {
    return ""
  }
}

export const userIdHash = (userId: string) => createHash("sha256").update(userId).digest("hex").slice(0, 8)

export type PushResult = { retryKey: string; outcome: "sent" | "already-accepted" }

export class LineMessagingClient {
  private token?: { value: string; refreshAt: number }
  private pendingToken?: Promise<string>
  private readonly fetch_: FetchLike
  private readonly now_: () => number
  private readonly timeoutMs_: number

  constructor(private readonly settings: LineOaClientSettings, private readonly deps: LineClientDeps = {}) {
    this.fetch_ = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.now_ = deps.now ?? Date.now
    this.timeoutMs_ = deps.timeoutMs ?? 10_000
  }

  private call(path: string, headers: Record<string, string>, body: string) {
    return this.fetch_(`${this.settings.apiBaseUrl}${path}`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs_),
    })
  }

  /** A valid stateless channel access token (cached until 60 s before it expires). */
  async accessToken(): Promise<string> {
    if (this.token && this.now_() < this.token.refreshAt) {
      return this.token.value
    }
    if (!this.pendingToken) {
      this.pendingToken = this.issueToken().finally(() => {
        this.pendingToken = undefined
      })
    }
    return this.pendingToken
  }

  private async issueToken(): Promise<string> {
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.settings.channelId,
      client_secret: this.settings.channelSecret,
    })
    const res = await this.call("/oauth2/v3/token", { "content-type": "application/x-www-form-urlencoded" }, form.toString())
    const raw = await res.text()
    if (res.status !== 200) {
      throw new LineApiError(res.status, `LINE token request failed: ${res.status} ${lineMessageOf(raw)}`.trim())
    }
    let parsed: { access_token?: unknown; expires_in?: unknown }
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new LineApiError(res.status, "LINE token response is not JSON")
    }
    if (typeof parsed.access_token !== "string" || !parsed.access_token || typeof parsed.expires_in !== "number") {
      throw new LineApiError(res.status, "LINE token response has no access_token / expires_in")
    }
    this.token = {
      value: parsed.access_token,
      refreshAt: this.now_() + parsed.expires_in * 1000 - TOKEN_EARLY_REFRESH_MS,
    }
    return parsed.access_token
  }

  private checkMessages(messages: LineMessage[]) {
    if (messages.length < 1 || messages.length > MAX_MESSAGES_PER_REQUEST) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `LINE accepts 1-${MAX_MESSAGES_PER_REQUEST} messages per request (got ${messages.length})`
      )
    }
  }

  private async send(path: string, payload: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; raw: string }> {
    const token = await this.accessToken()
    const res = await this.call(
      path,
      { "content-type": "application/json", authorization: `Bearer ${token}`, ...extraHeaders },
      JSON.stringify(payload)
    )
    if (res.status === 401) {
      this.token = undefined // revoked or expired early: the next call issues a new one
    }
    return { status: res.status, raw: await res.text() }
  }

  /** Replies to a webhook event (free). Not retried: reply tokens are single use. */
  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    this.checkMessages(messages)
    const res = await this.send("/v2/bot/message/reply", { replyToken, messages })
    if (res.status !== 200) {
      throw new LineApiError(res.status, `LINE reply failed: ${res.status} ${lineMessageOf(res.raw)}`.trim())
    }
  }

  /** Pushes to one user (billed). Retried once on 500 / network failure with the same retry key. */
  async push(to: string, messages: LineMessage[], retryKey: string = randomUUID()): Promise<PushResult> {
    this.checkMessages(messages)
    const attempt = () => this.send("/v2/bot/message/push", { to, messages }, { "x-line-retry-key": retryKey })
    let res: { status: number; raw: string }
    try {
      res = await attempt()
      if (res.status === 500) {
        res = await attempt()
      }
    } catch (e) {
      if (e instanceof LineApiError) {
        throw e // token request failed: nothing was sent
      }
      res = await attempt() // network error or timeout: same key, LINE de-duplicates
    }
    if (res.status !== 200 && res.status !== 409) {
      throw new LineApiError(res.status, `LINE push failed: ${res.status} ${lineMessageOf(res.raw)}`.trim())
    }
    this.deps.logger?.info(`[LINE-PUSH] userId_hash=${userIdHash(to)} count=${messages.length}`)
    return { retryKey, outcome: res.status === 409 ? "already-accepted" : "sent" }
  }
}
