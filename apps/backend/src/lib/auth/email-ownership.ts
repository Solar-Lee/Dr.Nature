// [P5-01 review auth-2] Proof that an auth identity owns an e-mail before a customer account may
// claim it. Medusa 2.21.2 lets ANY auth identity (emailpass, LINE, Google) create a customer with
// any e-mail, and findOrCreateCustomerStep then files later guest orders with that e-mail under
// that account (another person's name, address and phone: a 個資法 leak).
// Rules for "identity may claim e-mail E" (E = trim + lowercase):
//  (a) an emailpass identity may only claim its own login e-mail, and must still prove it by (c);
//  (b) a Google identity whose user_metadata.email is E is proof (auth-google refuses tokens
//      without email_verified);
//  (c) otherwise a verified auth_verification row (entity_type "email", entity_id E) of this
//      identity, from POST /auth/verification/request + /confirm (code e-mailed by
//      subscribers/auth-verification-email.ts).
// A LINE e-mail never counts (LINE gives no verified flag; the email scope is off anyway).
// Medusa's authVerificationsPerActor is NOT used: it checks the provider entity_id (the LINE /
// Google sub), never blocks POST /store/customers and matches case-sensitively.
import crypto from "crypto"

export const EMAIL_ENTITY = "email"
export const RESEND_COOLDOWN_MS = 60_000
export const PER_EMAIL_PER_HOUR = 5

export const normalizeEmail = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "")

type ProviderIdentity = { provider?: string | null; entity_id?: string | null; user_metadata?: Record<string, unknown> | null }
type Verification = { entity_id?: string | null; entity_type?: string | null; verified_at?: unknown }

export function emailProof(
  identity: { provider_identities?: ProviderIdentity[] | null },
  verifications: Verification[],
  email: string
): "google" | "token" | null {
  const pis = identity.provider_identities ?? []
  const emailpass = pis.find((p) => p.provider === "emailpass")
  if (emailpass && normalizeEmail(emailpass.entity_id) !== email) {
    return null
  }
  if (pis.some((p) => p.provider === "google" && normalizeEmail(p.user_metadata?.email) === email)) {
    return "google"
  }
  return verifications.some((v) => v.entity_type === EMAIL_ENTITY && normalizeEmail(v.entity_id) === email && !!v.verified_at) ? "token" : null
}

// Mirrors @medusajs/auth 2.21.2 utils/verification-token.js hashVerificationToken (sha256 hex,
// stored in provider_metadata.token_hash). If Medusa changes it, the confirm guard stops matching
// and every confirm is refused (fail closed); re-check on upgrades.
export const tokenHash = (code: string) => crypto.createHash("sha256").update(code).digest("hex")
