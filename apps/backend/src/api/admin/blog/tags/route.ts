// [P6-01] Admin blog tags. RBAC (src/api/middlewares.ts): GET blog_tag:read, POST
// blog_tag:create. GET ?q=&limit=&offset= (by name); POST { name, slug } -> 201 { tag }.
// Names are public, so a banned term in the name -> 400 BLOG_BANNED_TERMS.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createTerm, listTerms } from "../../../../lib/blog/admin"
import { ADMIN_TERM_LIST_QUERY, TERM_CREATE_SCHEMA, parseOrThrow } from "../../../../lib/blog/rules"
import { answerClaimsErrors } from "../claims-response"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const q = parseOrThrow(ADMIN_TERM_LIST_QUERY, req.query)
  const { rows, count } = await listTerms(req.scope, "tag", q)
  res.json({ tags: rows, count, limit: q.limit, offset: q.offset })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const input = parseOrThrow(TERM_CREATE_SCHEMA, req.body)
  await answerClaimsErrors(res, async () => {
    res.status(201).json({ tag: await createTerm(req.scope, "tag", input) })
  })
}
