// [LINE-03] LINE Messaging API webhook signature (x-line-signature).
// LINE signs the request body with HMAC-SHA256 keyed by the channel secret and sends the
// digest Base64-encoded. The digest must be computed over the RAW body bytes exactly as
// received (UTF-8): a parsed and re-serialized body (key order, spaces, escapes) does not
// verify. developers.line.biz/en/docs/messaging-api/verify-webhook-signature/ (2026-10-15).
// The comparison follows the official SDK (line-bot-sdk-nodejs lib/validate-signature.ts):
// length check first, then a constant-time compare.
// Never throws and never logs: callers decide what to record (never the body or the header).
import { createHmac, timingSafeEqual } from "crypto"

// Standard Base64 with padding; an HMAC-SHA256 digest is 32 bytes = 44 characters.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const toBuffer = (body: Buffer | string) => (typeof body === "string" ? Buffer.from(body, "utf8") : body)

/** Base64 HMAC-SHA256 of the body, as LINE puts it in x-line-signature. */
export function lineSignature(rawBody: Buffer | string, channelSecret: string): string {
  return createHmac("sha256", channelSecret).update(toBuffer(rawBody)).digest("base64")
}

/**
 * True only when `header` is the Base64 HMAC-SHA256 of `rawBody` keyed by `channelSecret`.
 * Missing secret, missing or empty body, missing / repeated / non-Base64 header: false.
 */
export function verifyLineSignature(
  rawBody: Buffer | string | null | undefined,
  channelSecret: string | null | undefined,
  header: string | string[] | null | undefined
): boolean {
  if (!channelSecret || typeof header !== "string" || header.length === 0) {
    return false
  }
  if (rawBody === null || rawBody === undefined) {
    return false
  }
  const body = toBuffer(rawBody)
  if (body.length === 0 || !BASE64.test(header)) {
    return false
  }
  const expected = createHmac("sha256", channelSecret).update(body).digest()
  const received = Buffer.from(header, "base64")
  if (received.length !== expected.length) {
    return false
  }
  return timingSafeEqual(received, expected)
}
