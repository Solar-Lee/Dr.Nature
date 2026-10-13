// [P5-01 review auth-2] Delivers e-mail verification codes (auth.verification_requested, Medusa
// 2.21.2 payload {entity_id, entity_type, code_provider, auth_identity_id, code, expires_at,
// metadata}). The link carries the code in the URL fragment so it never reaches servers or
// Referer headers; the storefront page /account/verify-email confirms it while the SAME
// identity is signed in (guardVerificationConfirm). event.data.metadata is caller-controlled and
// ignored. Delivery per EMAIL_PROVIDER (lib/email/config.ts): "log" (dev/test) writes the link to
// the log; "none" alerts staff without the code (the request route already answered 503).
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { EMAIL_ENTITY } from "../lib/auth/email-ownership"
import { emailDeliveryFromEnv, tellStaffEmailMissing } from "../lib/email/config"

type VerificationRequested = { entity_id?: string; entity_type?: string; code_provider?: string; code?: string }

export default async function authVerificationEmailHandler({ event, container }: SubscriberArgs<VerificationRequested>) {
  const { entity_id, entity_type, code_provider, code } = event.data
  if (entity_type !== EMAIL_ENTITY || code_provider !== "token" || !code || !entity_id) {
    return // other kinds, or an already verified row (Medusa emits it without a code)
  }
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const delivery = emailDeliveryFromEnv()
  if (delivery === "none") {
    await tellStaffEmailMissing(container)
    logger.error("[EMAIL-ALERT] an e-mail verification was requested but no e-mail provider is configured (U-09)")
    return
  }
  const link = `${(process.env.STOREFRONT_URL ?? "").replace(/\/$/, "")}/account/verify-email#code=${encodeURIComponent(code)}`
  logger.info(`[email:log] verification link for ${entity_id}: ${link}`)
}

export const config: SubscriberConfig = {
  event: "auth.verification_requested",
  context: { subscriberId: "drn-auth-verification-email" },
}
