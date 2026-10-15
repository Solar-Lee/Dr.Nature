// [LINE-07] G3 option 3 (Aki, 2026-10-15): Medusa receives the official account's webhook and
// passes it on to the group-buy bot. After the signature check, the ORIGINAL raw body bytes are
// POSTed to LINE_OA_FORWARD_URL with the original x-line-signature and content-type, so the bot
// can verify them with the same channel secret exactly as if LINE had called it
// (developers.line.biz/en/docs/messaging-api/verify-webhook-signature/: the signature covers
// the unmodified body).
// Fire-and-forget: the caller does not await it, the 200 to LINE never waits for it, it is
// never retried, it gives up after 5 s and it never rejects. Failures are logged as
// [LINE-FORWARD] with the reason only: never the body, the signature or the URL (which may
// carry a token).
// LINE_OA_FORWARD_URL unset or empty -> nothing is forwarded.
type WarnLogger = { warn(message: string): void }

export type ForwardFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: Uint8Array; signal: AbortSignal }
) => Promise<{ status: number }>

export type ForwardInput = { rawBody: Buffer; signature: string; contentType?: string }
export type ForwardDeps = { url?: string; fetch?: ForwardFetch; logger: WarnLogger; timeoutMs?: number }

export const FORWARD_TIMEOUT_MS = 5000

const reasonOf = (e: unknown) => {
  const name = (e as Error)?.name
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network error"
}

/** Starts the forward and returns its promise (never rejects), or null when no URL is set. */
export function forwardLineWebhook(input: ForwardInput, deps: ForwardDeps): Promise<void> | null {
  const url = (deps.url ?? process.env.LINE_OA_FORWARD_URL)?.trim()
  if (!url) {
    return null
  }
  const run = async () => {
    const target = URL.canParse(url) ? new URL(url) : null
    if (!target || (target.protocol !== "https:" && target.protocol !== "http:")) {
      deps.logger.warn("[LINE-FORWARD] failed: LINE_OA_FORWARD_URL is not an http(s) URL")
      return
    }
    try {
      const fetchFn = deps.fetch ?? (globalThis.fetch as unknown as ForwardFetch)
      const res = await fetchFn(target.toString(), {
        method: "POST",
        headers: {
          "content-type": input.contentType || "application/json; charset=utf-8",
          "x-line-signature": input.signature,
        },
        body: new Uint8Array(input.rawBody),
        signal: AbortSignal.timeout(deps.timeoutMs ?? FORWARD_TIMEOUT_MS),
      })
      if (res.status < 200 || res.status >= 300) {
        deps.logger.warn(`[LINE-FORWARD] failed: status ${res.status}`)
      }
    } catch (e) {
      deps.logger.warn(`[LINE-FORWARD] failed: ${reasonOf(e)}`)
    }
  }
  return run()
}
