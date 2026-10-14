// [P6-01] Store: visible blog posts (status published, published_at <= now), newest first.
// Requires the publishable key like every /store route. Query: limit (1-100, default 20), offset,
// category=<slug>, tag=<slug>, type=pillar|cluster. -> { posts, count, limit, offset }
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { STORE_LIST_QUERY, parseOrThrow } from "../../../../lib/blog/rules"
import { listVisiblePosts } from "../../../../lib/blog/store"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const q = parseOrThrow(STORE_LIST_QUERY, req.query)
  const { posts, count } = await listVisiblePosts(req.scope, q)
  res.json({ posts, count, limit: q.limit, offset: q.offset })
}
