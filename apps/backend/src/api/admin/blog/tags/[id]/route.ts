// [P6-01] One admin blog tag. RBAC (src/api/middlewares.ts): GET blog_tag:read, POST
// blog_tag:update, DELETE blog_tag:delete (its links to posts are removed with it).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { deleteTerm, retrieveTerm, updateTerm } from "../../../../../lib/blog/admin"
import { TERM_UPDATE_SCHEMA, parseOrThrow } from "../../../../../lib/blog/rules"
import { answerClaimsErrors } from "../../claims-response"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ tag: await retrieveTerm(req.scope, "tag", req.params.id) })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const patch = parseOrThrow(TERM_UPDATE_SCHEMA, req.body)
  await answerClaimsErrors(res, async () => {
    res.json({ tag: await updateTerm(req.scope, "tag", req.params.id, patch) })
  })
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  await deleteTerm(req.scope, "tag", req.params.id)
  res.json({ id: req.params.id, object: "blog_tag", deleted: true })
}
