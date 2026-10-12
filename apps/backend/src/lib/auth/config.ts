// [P5-01] Customer login providers (medusa-config.ts). E-mail + password always; Google and LINE
// only when their credentials are set (docs/ENV.md), so builds and tests need no secrets. A half
// configured provider stops the boot (fail closed). Staff (actor "user") log in with e-mail +
// password only.
// OAuth callbacks land on the storefront (P7 implements these pages), which relays code + state
// to POST /auth/customer/{google|line}/callback. Register exactly these URLs in Google Cloud
// Console and LINE Developers (Aki).
import { MedusaError } from "@medusajs/framework/utils"

export const OAUTH_CALLBACK_PATHS = { google: "/auth/callback/google", line: "/auth/callback/line" } as const

type Provider = { resolve: string; id: string; options?: Record<string, unknown> }

function pair(env: NodeJS.ProcessEnv, idKey: string, secretKey: string): [string, string] | null {
  const id = env[idKey]?.trim()
  const secret = env[secretKey]?.trim()
  if (!id && !secret) {
    return null
  }
  if (!id || !secret) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${idKey} and ${secretKey} must be set together`)
  }
  return [id, secret]
}

export function authProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): { providers: Provider[]; customerMethods: string[] } {
  const providers: Provider[] = [{ resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" }]
  const customerMethods = ["emailpass"]
  const google = pair(env, "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET")
  const line = pair(env, "LINE_LOGIN_CHANNEL_ID", "LINE_LOGIN_CHANNEL_SECRET")
  if (!google && !line) {
    return { providers, customerMethods }
  }
  const storefront = env.STOREFRONT_URL?.trim().replace(/\/$/, "")
  if (!storefront) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "STOREFRONT_URL is required for Google / LINE login callbacks")
  }
  if (env.NODE_ENV === "production" && !storefront.startsWith("https://")) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "STOREFRONT_URL must be https in production (OAuth callbacks)")
  }
  if (google) {
    providers.push({
      resolve: "@medusajs/medusa/auth-google",
      id: "google",
      options: { clientId: google[0], clientSecret: google[1], callbackUrl: `${storefront}${OAUTH_CALLBACK_PATHS.google}` },
    })
    customerMethods.push("google")
  }
  if (line) {
    providers.push({
      resolve: "./src/modules/line-auth",
      id: "line",
      options: {
        channelId: line[0],
        channelSecret: line[1],
        callbackUrl: `${storefront}${OAUTH_CALLBACK_PATHS.line}`,
        ...(env.LINE_LOGIN_API_BASE_URL ? { apiBaseUrl: env.LINE_LOGIN_API_BASE_URL } : {}),
      },
    })
    customerMethods.push("line")
  }
  return { providers, customerMethods }
}
