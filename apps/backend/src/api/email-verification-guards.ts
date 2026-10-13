// [P5-01 review auth-2] Middlewares (registered in middlewares.ts; they run after Medusa's own
// authenticate + body validation on the same routes):
//  - POST /store/customers: the caller's auth identity must prove it owns the e-mail
//    (lib/auth/email-ownership.ts); the e-mail is stored lowercase, the form guest checkout uses.
//  - POST /auth/verification/request: only customers verifying an e-mail with the token provider;
//    an emailpass identity only its login e-mail; no mail provider -> 503 + staff notice; at most
//    one request a minute per identity and PER_EMAIL_PER_HOUR per address; client metadata
//    dropped (it would reach the e-mail); provider_metadata (token_hash) removed from the
//    response (Medusa returns the stored row; the shopper never needs it).
//  - POST /auth/verification/confirm: Medusa 2.21.2 confirms by code alone, unauthenticated
//    (token.js:52-76), so a victim clicking a link an ATTACKER requested would verify the
//    attacker's identity for the victim's e-mail. Require the identity that requested the code.
import type { AuthenticatedMedusaRequest, MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http"
import type { IAuthModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules, validateEmail } from "@medusajs/framework/utils"
import { EMAIL_ENTITY, PER_EMAIL_PER_HOUR, RESEND_COOLDOWN_MS, emailProof, normalizeEmail, tokenHash } from "../lib/auth/email-ownership"
import { emailDeliveryFromEnv, tellStaffEmailMissing } from "../lib/email/config"

const authModule = (req: AuthenticatedMedusaRequest) => req.scope.resolve<IAuthModuleService>(Modules.AUTH)

export const EMAIL_NOT_VERIFIED = "請先驗證這個 Email 再建立會員（EMAIL_NOT_VERIFIED）"

export const requireEmailProof = async (req: AuthenticatedMedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) => {
  try {
    const ctx = req.auth_context
    if (!ctx?.auth_identity_id) {
      return next(new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized"))
    }
    if (ctx.actor_id) {
      return next() // Medusa answers "Request already authenticated as a customer."
    }
    const body = req.validatedBody as { email?: string | null }
    const email = normalizeEmail(body?.email)
    if (!email) {
      return next() // Medusa answers "Email is required to create a customer"
    }
    const auth = authModule(req)
    const identity = await auth.retrieveAuthIdentity(ctx.auth_identity_id, { relations: ["provider_identities"] })
    const verifications = await auth.listAuthVerifications({ auth_identity_id: ctx.auth_identity_id, entity_type: EMAIL_ENTITY, entity_id: email })
    if (!emailProof(identity, verifications, email)) {
      return next(new MedusaError(MedusaError.Types.FORBIDDEN, EMAIL_NOT_VERIFIED))
    }
    body.email = email
    return next()
  } catch (e) {
    return next(e)
  }
}

export const guardVerificationRequest = async (req: AuthenticatedMedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
  try {
    const ctx = req.auth_context
    const b = req.validatedBody as { entity_id: string; entity_type: string; code_provider?: string; metadata?: Record<string, unknown> }
    if (ctx?.actor_type !== "customer" || b.entity_type !== EMAIL_ENTITY || (b.code_provider ?? "token") !== "token") {
      return next(new MedusaError(MedusaError.Types.FORBIDDEN, "Only customer e-mail verification is enabled"))
    }
    const email = validateEmail(normalizeEmail(b.entity_id))
    if (emailDeliveryFromEnv() === "none") {
      await tellStaffEmailMissing(req.scope)
      res.status(503).json({ type: "unexpected_state", message: "目前無法寄出驗證信，請改用 Google 登入或稍後再試。" })
      return
    }
    const auth = authModule(req)
    const identity = await auth.retrieveAuthIdentity(ctx.auth_identity_id, { relations: ["provider_identities"] })
    const emailpass = identity.provider_identities?.find((p) => p.provider === "emailpass")
    if (emailpass && normalizeEmail(emailpass.entity_id) !== email) {
      return next(new MedusaError(MedusaError.Types.FORBIDDEN, "只能驗證登入用的 Email"))
    }
    const now = Date.now()
    const age = (v: { requested_at?: Date | string | null }) => now - new Date(v.requested_at ?? 0).getTime()
    const all = await auth.listAuthVerifications({ entity_type: EMAIL_ENTITY, entity_id: email })
    const own = all.find((v) => v.auth_identity_id === ctx.auth_identity_id)
    const recent = all.filter((v) => !v.verified_at && age(v) < 3_600_000).length
    if ((own && !own.verified_at && age(own) < RESEND_COOLDOWN_MS) || recent >= PER_EMAIL_PER_HOUR) {
      res.status(429).json({ type: "not_allowed", message: "驗證信寄送太頻繁，請稍後再試。" })
      return
    }
    b.entity_id = email
    b.metadata = {}
    const send = res.json.bind(res)
    res.json = ((body: { verification?: Record<string, unknown> } | undefined) => {
      if (body?.verification) {
        const { provider_metadata: _hidden, ...verification } = body.verification
        return send({ ...body, verification })
      }
      return send(body)
    }) as typeof res.json
    return next()
  } catch (e) {
    return next(e)
  }
}

export const guardVerificationConfirm = async (req: AuthenticatedMedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) => {
  try {
    const id = req.auth_context?.auth_identity_id
    if (!id) {
      return next(new MedusaError(MedusaError.Types.UNAUTHORIZED, "請先登入要驗證的帳號，再開啟驗證連結。"))
    }
    const code = String((req.validatedBody as { code?: unknown })?.code ?? "")
    const mine = await authModule(req).listAuthVerifications({ auth_identity_id: id, entity_type: EMAIL_ENTITY })
    if (!mine.some((v) => (v.provider_metadata as { token_hash?: string } | null)?.token_hash === tokenHash(code))) {
      return next(new MedusaError(MedusaError.Types.FORBIDDEN, "這個驗證連結屬於另一個登入帳號。"))
    }
    return next()
  } catch (e) {
    return next(e)
  }
}
