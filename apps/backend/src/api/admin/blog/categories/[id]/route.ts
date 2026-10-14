// [P6-01] One admin blog category. RBAC (src/api/middlewares.ts): GET blog_category:read, POST
// blog_category:update, DELETE blog_category:delete (its links to posts are removed with it).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { deleteTerm, retrieveTerm, updateTerm } from "../../../../../lib/blog/admin"
import { TERM_UPDATE_SCHEMA, parseOrThrow } from "../../../../../lib/blog/rules"
import { answerClaimsErrors } from "../../claims-response"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ category: await retrieveTerm(req.scope, "category", req.params.id) })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const patch = parseOrThrow(TERM_UPDATE_SCHEMA, req.body)
  await answerClaimsErrors(res, async () => {
    res.json({ category: await updateTerm(req.scope, "category", req.params.id, patch) })
  })
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  await deleteTerm(req.scope, "category", req.params.id)
  res.json({ id: req.params.id, object: "blog_category", deleted: true })
}
