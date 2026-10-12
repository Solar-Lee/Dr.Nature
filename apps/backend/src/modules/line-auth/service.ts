// [P5-01] LINE Login v2.1 for customers (docs/research/p4-p5-2026-10-13.md §4; developers.line.biz).
//  authenticate:    redirect to https://access.line.me/oauth2/v2.1/authorize (response_type=code,
//                   client_id, redirect_uri, state, scope, nonce, bot_prompt). state -> nonce is
//                   kept in the auth module's cache (single use, 20 min).
//  validateCallback: code -> POST https://api.line.me/oauth2/v2.1/token; the ID token is checked
//                   by LINE itself (POST /oauth2/v2.1/verify with client_id and our nonce; web
//                   login tokens are HS256 with the channel secret), then iss / aud / nonce / sub
//                   are re-checked here. The auth identity is keyed by the LINE user id (sub).
//  - The redirect URI is ONLY the configured one (no client-supplied callback_url).
//  - E-mail is not requested: LINE grants the email scope only after an application in the
//    LINE Developers console, and users may refuse it anyway. TODO(需查證): Aki applies, then
//    set REQUEST_EMAIL = true. Medusa 2.21.2 needs an e-mail to create the customer, so after a
//    first LINE login the storefront asks for one (POST /store/customers with the LINE token).
//  - bot_prompt=normal offers "add the official account as a friend" on the consent screen
//    (needs the OA linked to this channel in the console).
import crypto from "crypto"
import { AbstractAuthModuleProvider, MedusaError } from "@medusajs/framework/utils"
import type { AuthenticationInput, AuthenticationResponse, AuthIdentityProviderService, Logger } from "@medusajs/framework/types"

export type LineAuthOptions = {
  channelId: string
  channelSecret: string
  callbackUrl: string
  // Test/dev only: token + verify host (a local stub). Refused when NODE_ENV=production.
  apiBaseUrl?: string
}

const ACCESS_BASE = "https://access.line.me"
const API_BASE = "https://api.line.me"
const ISSUER = "https://access.line.me"
const REQUEST_EMAIL = false
const TIMEOUT_MS = 10_000

type LineIdPayload = { iss?: string; sub?: string; aud?: string; nonce?: string; name?: string; picture?: string; email?: string }

const str = (v: unknown) => (typeof v === "string" ? v : "")

export default class LineAuthService extends AbstractAuthModuleProvider {
  static identifier = "line"
  static DISPLAY_NAME = "LINE Login"

  protected options_: LineAuthOptions
  protected logger_: Logger

  static validateOptions(options: Record<string, unknown>) {
    for (const k of ["channelId", "channelSecret", "callbackUrl"]) {
      if (!str(options[k])) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `LINE Login ${k} is required`)
      }
    }
    if (options.apiBaseUrl && process.env.NODE_ENV === "production") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "LINE_LOGIN_API_BASE_URL must not be set in production")
    }
  }

  constructor({ logger }: { logger: Logger }, options: LineAuthOptions) {
    // @ts-ignore -- AbstractAuthModuleProvider takes (container, options)
    super(...arguments)
    this.options_ = options
    this.logger_ = logger
  }

  private get api() {
    return (this.options_.apiBaseUrl ?? API_BASE).replace(/\/$/, "")
  }

  async register(): Promise<AuthenticationResponse> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "LINE does not support registration. Use authenticate instead.")
  }

  async authenticate(req: AuthenticationInput, svc: AuthIdentityProviderService): Promise<AuthenticationResponse> {
    if (req.query?.error) {
      return { success: false, error: `LINE: ${str(req.query.error_description) || str(req.query.error)}` }
    }
    const state = crypto.randomBytes(32).toString("hex")
    const nonce = crypto.randomBytes(16).toString("hex")
    await svc.setState(state, { nonce })
    const url = new URL(`${ACCESS_BASE}/oauth2/v2.1/authorize`)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", this.options_.channelId)
    url.searchParams.set("redirect_uri", this.options_.callbackUrl)
    url.searchParams.set("state", state)
    url.searchParams.set("scope", REQUEST_EMAIL ? "profile openid email" : "profile openid")
    url.searchParams.set("nonce", nonce)
    url.searchParams.set("bot_prompt", "normal")
    return { success: true, location: url.toString() }
  }

  async validateCallback(req: AuthenticationInput, svc: AuthIdentityProviderService): Promise<AuthenticationResponse> {
    const query = (req.query ?? {}) as Record<string, unknown>
    if (query.error) {
      // e.g. access_denied when the user cancels on the consent screen
      return { success: false, error: `LINE: ${str(query.error_description) || str(query.error)}` }
    }
    const code = str(query.code) || str((req.body as Record<string, unknown> | undefined)?.code)
    if (!code) {
      return { success: false, error: "No code provided" }
    }
    const saved = (await svc.getState(str(query.state))) as { nonce?: string } | null
    if (!saved?.nonce) {
      return { success: false, error: "No state provided, or session expired" }
    }
    try {
      const token = await this.post<{ id_token?: string }>("/oauth2/v2.1/token", {
        grant_type: "authorization_code",
        code,
        redirect_uri: this.options_.callbackUrl,
        client_id: this.options_.channelId,
        client_secret: this.options_.channelSecret,
      })
      if (!token.id_token) {
        return { success: false, error: "LINE returned no ID token" }
      }
      const p = await this.post<LineIdPayload>("/oauth2/v2.1/verify", {
        id_token: token.id_token,
        client_id: this.options_.channelId,
        nonce: saved.nonce,
      })
      if (p.iss !== ISSUER || p.aud !== this.options_.channelId || p.nonce !== saved.nonce || !p.sub) {
        return { success: false, error: "LINE ID token does not match this login" }
      }
      return { success: true, authIdentity: await this.identityFor(p, svc) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }

  private async identityFor(p: LineIdPayload, svc: AuthIdentityProviderService) {
    const user_metadata = { name: p.name ?? null, picture: p.picture ?? null, email: p.email ?? null }
    try {
      return await svc.retrieve({ entity_id: p.sub! })
    } catch (e) {
      if ((e as MedusaError).type !== MedusaError.Types.NOT_FOUND) {
        throw e
      }
      return await svc.create({ entity_id: p.sub!, user_metadata })
    }
  }

  private async post<T>(path: string, form: Record<string, string>): Promise<T> {
    const res = await fetch(`${this.api}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json().catch(() => ({}))) as T & { error?: string; error_description?: string }
    if (!res.ok) {
      // Never log the request: it carries the channel secret and the code.
      throw new MedusaError(MedusaError.Types.UNAUTHORIZED, `LINE ${path} refused: ${body.error_description ?? body.error ?? res.status}`)
    }
    return body
  }
}
