// [P6-01] Store: one visible blog post by slug (404 for drafts, scheduled and unknown slugs), with
// body_markdown; a cluster carries its pillar (null while the pillar is not visible), a pillar
// carries its visible clusters (newest first). -> { post }
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { visiblePostBySlug } from "../../../../../lib/blog/store"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({ post: await visiblePostBySlug(req.scope, req.params.slug) })
}
