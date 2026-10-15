// [P6-01] A banned term in customer-facing blog text -> 400 with the offending terms:
// { type: "invalid_data", code: "BLOG_BANNED_TERMS", message, terms: [...], hits: [{ field, term,
// reason, line, column }] }. Other errors go to Medusa's error handler unchanged.
import type { MedusaResponse } from "@medusajs/framework/http"
import { BlogClaimsError } from "../../../lib/blog/claims"

export async function answerClaimsErrors(res: MedusaResponse, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    if (!(e instanceof BlogClaimsError)) throw e
    res.status(400).json({
      type: "invalid_data",
      code: "BLOG_BANNED_TERMS",
      message: e.message,
      terms: e.terms,
      hits: e.hits.map(({ field, term, reason, line, column }) => ({ field, term, reason, line, column })),
    })
  }
}
