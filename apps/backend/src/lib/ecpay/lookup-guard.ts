// Bounds the ECPay e-invoice lookups made at checkout (P4-06 review). Anyone with the public
// publishable key can trigger cart completion, and ECPay blocks the whole merchant for ~30
// minutes when rate-limited (HTTP 403, INV-01) — which would also stop invoice issuing.
//  - a per-process budget of lookups per minute (over budget = accept unchecked, as when
//    ECPay is unavailable);
//  - definite answers are cached per value, so repeats cost nothing.
const WINDOW_MS = 60_000
const MAX_LOOKUPS_PER_WINDOW = 20
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const CACHE_MAX = 5_000

export type LookupVerdict = "valid" | "invalid"

const window = { start: 0, used: 0 }
const cache = new Map<string, { verdict: LookupVerdict; at: number }>()

export function cachedLookup(key: string, now = Date.now()): LookupVerdict | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return hit.verdict
}

export function rememberLookup(key: string, verdict: LookupVerdict, now = Date.now()) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value as string) // oldest insertion
  }
  cache.set(key, { verdict, at: now })
}

// True when a live lookup may be made now (and counts it).
export function takeLookupBudget(now = Date.now()): boolean {
  if (now - window.start >= WINDOW_MS) {
    window.start = now
    window.used = 0
  }
  if (window.used >= MAX_LOOKUPS_PER_WINDOW) return false
  window.used++
  return true
}

export function resetLookupGuard() {
  window.start = 0
  window.used = 0
  cache.clear()
}
