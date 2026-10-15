// [P6-01] Blog reads for the Store API (src/api/store/blog/**). Only visible posts: status
// "published" and published_at <= now (drafts and scheduled posts are invisible, also as a
// cluster's pillar or in a pillar's cluster list).
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { blogService } from "./admin"
import { visibleFilter, type PostState } from "./rules"

type Term = { id: string; name: string; slug: string }
type PostRow = PostState & { id: string; updated_at: Date; categories?: Term[]; tags?: Term[] }

const termOut = (t: Term) => ({ id: t.id, name: t.name, slug: t.slug })
// Code-point order (not localeCompare): the same result on every machine and locale.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const byName = (a: Term, b: Term) => cmp(a.name, b.name) || cmp(a.slug, b.slug)
const NEWEST_FIRST = { published_at: "DESC" as const, id: "DESC" as const }

export function storePostSummary(p: PostRow) {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    type: p.type,
    excerpt: p.excerpt,
    author_name: p.author_name,
    published_at: p.published_at,
    updated_at: p.updated_at,
    meta_title: p.meta_title,
    meta_description: p.meta_description,
    canonical_url: p.canonical_url,
    og_image_url: p.og_image_url,
    noindex: p.noindex,
    categories: (p.categories ?? []).map(termOut).sort(byName),
    tags: (p.tags ?? []).map(termOut).sort(byName),
  }
}

const postLink = (p: PostRow) => ({ id: p.id, title: p.title, slug: p.slug, type: p.type, excerpt: p.excerpt, published_at: p.published_at })

// Post ids carrying the category / tag with this slug (null = no filter; [] = no such term).
async function idsWithTerm(container: MedusaContainer, kind: "category" | "tag", slug: string | undefined): Promise<string[] | null> {
  if (!slug) return null
  const svc = blogService(container)
  const config = { relations: ["posts"], select: ["id", "posts.id"] }
  const [term] = (
    kind === "category" ? await svc.listBlogCategories({ slug }, config) : await svc.listBlogTags({ slug }, config)
  ) as unknown as { posts?: { id: string }[] }[]
  return term ? (term.posts ?? []).map((p) => p.id) : []
}

export async function listVisiblePosts(
  container: MedusaContainer,
  q: { limit: number; offset: number; category?: string; tag?: string; type?: string },
  now = new Date()
) {
  const filters: Record<string, unknown> = { ...visibleFilter(now) }
  if (q.type) filters.type = q.type
  let ids: string[] | null = null
  for (const [kind, slug] of [["category", q.category], ["tag", q.tag]] as const) {
    const withTerm = await idsWithTerm(container, kind, slug)
    if (withTerm) ids = ids ? ids.filter((id) => withTerm.includes(id)) : withTerm
  }
  if (ids && !ids.length) return { posts: [], count: 0 }
  if (ids) filters.id = ids
  const [rows, count] = await blogService(container).listAndCountBlogPosts(filters, {
    relations: ["categories", "tags"],
    order: NEWEST_FIRST,
    take: q.limit,
    skip: q.offset,
  })
  return { posts: (rows as unknown as PostRow[]).map(storePostSummary), count }
}

export async function visiblePostBySlug(container: MedusaContainer, slug: string, now = new Date()) {
  const svc = blogService(container)
  const [post] = (await svc.listBlogPosts({ slug, ...visibleFilter(now) }, { relations: ["categories", "tags"] })) as unknown as PostRow[]
  if (!post) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Blog post ${slug} was not found`)
  }
  let pillar: ReturnType<typeof postLink> | null = null
  let clusters: ReturnType<typeof postLink>[] = []
  if (post.type === "cluster" && post.pillar_id) {
    const [p] = (await svc.listBlogPosts({ id: post.pillar_id, ...visibleFilter(now) })) as unknown as PostRow[]
    pillar = p ? postLink(p) : null
  }
  if (post.type === "pillar") {
    const rows = (await svc.listBlogPosts({ pillar_id: post.id, ...visibleFilter(now) }, { order: NEWEST_FIRST })) as unknown as PostRow[]
    clusters = rows.map(postLink)
  }
  return { ...storePostSummary(post), body_markdown: post.body_markdown, pillar, clusters }
}

export async function listCategories(container: MedusaContainer) {
  const rows = (await blogService(container).listBlogCategories({})) as unknown as Term[]
  return rows.sort(byName).map(termOut)
}
