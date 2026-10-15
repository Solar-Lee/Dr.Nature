// [LINE-06] Per-process LINE objects for the webhook route: the reply content (read once; a
// problem with the content file is logged once) and the Messaging API client (rebuilt only when
// the channel settings change, so its token cache survives between webhooks).
import type { Logger } from "@medusajs/framework/types"
import { LineMessagingClient } from "./client"
import { lineOaClientSettingsFromEnv } from "./config"
import { loadLineReplies, type LineReplies } from "./replies"

let replies: LineReplies | undefined
let client: { key: string; value: LineMessagingClient } | undefined

export function lineReplies(logger: Logger): LineReplies {
  if (!replies) {
    const loaded = loadLineReplies()
    if (loaded.problem) {
      logger.error(`[LINE-WEBHOOK] ${loaded.problem}; using the built-in minimal replies`)
    }
    replies = loaded.replies
  }
  return replies
}

export function lineClient(logger: Logger): LineMessagingClient | null {
  const settings = lineOaClientSettingsFromEnv()
  if (!settings) {
    return null
  }
  const key = `${settings.channelId}|${settings.channelSecret}|${settings.apiBaseUrl}`
  if (client?.key !== key) {
    client = { key, value: new LineMessagingClient(settings, { logger }) }
  }
  return client.value
}
