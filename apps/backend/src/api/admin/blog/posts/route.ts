// [P6-01] Admin blog posts. RBAC (src/api/middlewares.ts): GET blog_post:read, POST blog_post:create
// (content_editor and Super Admin). Rules: src/lib/blog/rules.ts, writes: src/lib/blog/admin.ts.
// GET  ?q=&status=draft|published&type=pillar|cluster&pillar_id=&limit=&offset=  (newest update first)
// POST { title, slug, type, pillar_id?, excerpt?, body_markdown?, status?, published_at?, author_name?,
//        meta_title?, meta_description?, canonical_url?, og_image_url?, noindex?, category_ids?, tag_ids? }
//      -> 201 { post }; a banned term while publishing -> 400 BLOG_BANNED_TERMS (claims-response.ts)
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminPost, blogService, createPost, escapeLike } from "../../../../lib/blog/admin"
import { ADMIN_POST_LIST_QUERY, POST_CREATE_SCHEMA, parseOrThrow } from "../../../../lib/blog/rules"
import { answerClaimsErrors } from "../claims-response"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const q = parseOrThrow(ADMIN_POST_LIST_QUERY, req.query)
  const filters: Record<string, unknown> = {}
  if (q.status) filters.status = q.status
  if (q.type) filters.type = q.type
  if (q.pillar_id) filters.pillar_id = q.pillar_id
  if (q.q) filters.$or = [{ title: { $ilike: `%${escapeLike(q.q)}%` } }, { slug: { $ilike: `%${escapeLike(q.q)}%` } }]
  const [rows, count] = await blogService(req.scope).listAndCountBlogPosts(filters, {
    relations: ["pillar", "categories", "tags"],
    order: { updated_at: "DESC", id: "DESC" },
    take: q.limit,
    skip: q.offset,
  })
  const now = new Date()
  res.json({ posts: rows.map((p) => adminPost(p as any, now)), count, limit: q.limit, offset: q.offset })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const input = parseOrThrow(POST_CREATE_SCHEMA, req.body)
  await answerClaimsErrors(res, async () => {
    const post = await createPost(req.scope, input)
    res.status(201).json({ post: adminPost(post, new Date()) })
  })
}
