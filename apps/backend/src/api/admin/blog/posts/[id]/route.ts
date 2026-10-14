// [P6-01] One admin blog post. RBAC (src/api/middlewares.ts): GET blog_post:read, POST
// blog_post:update, DELETE blog_post:delete. POST is a partial update (omitted fields stay, null
// clears, category_ids / tag_ids replace the set). A pillar that still has clusters can be neither
// deleted nor turned into a cluster (400). Publishing with a banned term -> 400 BLOG_BANNED_TERMS.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminPost, deletePost, retrievePost, updatePost } from "../../../../../lib/blog/admin"
import { POST_UPDATE_SCHEMA, parseOrThrow } from "../../../../../lib/blog/rules"
import { answerClaimsErrors } from "../../claims-response"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ post: adminPost(await retrievePost(req.scope, req.params.id), new Date()) })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const patch = parseOrThrow(POST_UPDATE_SCHEMA, req.body)
  await answerClaimsErrors(res, async () => {
    const { after } = await updatePost(req.scope, req.params.id, patch)
    res.json({ post: adminPost(after, new Date()) })
  })
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  await deletePost(req.scope, req.params.id)
  res.json({ id: req.params.id, object: "blog_post", deleted: true })
}
