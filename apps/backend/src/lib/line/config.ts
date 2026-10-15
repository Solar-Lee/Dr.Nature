// [LINE-05] LINE Official Account (Messaging API channel) settings from the environment
// (names whitelisted in docs/ENV.md, LINE-02).
//  - LINE_OA_CHANNEL_ID + LINE_OA_CHANNEL_SECRET: both set -> the client can issue tokens and
//    reply / push; either missing -> no client (the webhook still answers, nothing is sent).
//  - LINE_OA_API_BASE_URL: test / development stub host only. Refused when NODE_ENV=production
//    (boot fails from medusa-config.ts), like LINE_LOGIN_API_BASE_URL.
import { MedusaError } from "@medusajs/framework/utils"

export const LINE_API_BASE = "https://api.line.me"

export type LineOaClientSettings = {
  channelId: string
  channelSecret: string
  apiBaseUrl: string
}

/** Throws when the environment would point production at a stub. Called at boot. */
export function assertLineOaEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.LINE_OA_API_BASE_URL && env.NODE_ENV === "production") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "LINE_OA_API_BASE_URL must not be set in production")
  }
}

/** Client settings, or null when the channel ID or secret is missing. */
export function lineOaClientSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): LineOaClientSettings | null {
  assertLineOaEnv(env)
  const channelId = env.LINE_OA_CHANNEL_ID?.trim()
  const channelSecret = env.LINE_OA_CHANNEL_SECRET?.trim()
  if (!channelId || !channelSecret) {
    return null
  }
  return {
    channelId,
    channelSecret,
    apiBaseUrl: (env.LINE_OA_API_BASE_URL?.trim() || LINE_API_BASE).replace(/\/+$/, ""),
  }
}
