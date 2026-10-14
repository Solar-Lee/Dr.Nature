// [P6-01] Blog writes for the admin routes (src/api/admin/blog/**). The only write path: it applies
// the rules of rules.ts plus the checks that need the database (unique slugs, the pillar a
// cluster points to, a pillar's clusters, unknown categories / tags).
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { BLOG_MODULE } from "../../modules/blog"
import type BlogModuleService from "../../modules/blog/service"
import { assertNoBannedClaims } from "./claims"
import {
  changedColumns,
  nextPostState,
  visibilityOf,
  type PostCreateInput,
  type PostState,
  type PostUpdateInput,
  type TermCreateInput,
  type TermUpdateInput,
} from "./rules"

export const blogService = (container: MedusaContainer) => container.resolve<BlogModuleService>(BLOG_MODULE)

export const POST_RELATIONS = ["pillar", "clusters", "categories", "tags"]

type Term = { id: string; name: string; slug: string }
type PostRow = PostState & {
  id: string
  created_at: Date
  updated_at: Date
  pillar?: (PostState & { id: string }) | null
  clusters?: (PostState & { id: string })[]
  categories?: Term[]
  tags?: Term[]
}

const termOut = (t: Term) => ({ id: t.id, name: t.name, slug: t.slug })
// Code-point order (not localeCompare): the same result on every machine and locale.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const byName = (a: Term, b: Term) => cmp(a.name, b.name) || cmp(a.slug, b.slug)

export function adminPost(p: PostRow, now: Date) {
  const link = (x: PostState & { id: string }) => ({
    id: x.id,
    title: x.title,
    slug: x.slug,
    type: x.type,
    status: x.status,
    published_at: x.published_at,
    visibility: visibilityOf(x, now),
  })
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    type: p.type,
    pillar_id: p.pillar_id,
    excerpt: p.excerpt,
    body_markdown: p.body_markdown,
    status: p.status,
    published_at: p.published_at,
    visibility: visibilityOf(p, now),
    author_name: p.author_name,
    meta_title: p.meta_title,
    meta_description: p.meta_description,
    canonical_url: p.canonical_url,
    og_image_url: p.og_image_url,
    noindex: p.noindex,
    created_at: p.created_at,
    updated_at: p.updated_at,
    pillar: p.pillar ? link(p.pillar) : null,
    clusters: p.clusters ? p.clusters.map(link) : undefined,
    categories: (p.categories ?? []).map(termOut).sort(byName),
    tags: (p.tags ?? []).map(termOut).sort(byName),
  }
}

export async function retrievePost(container: MedusaContainer, id: string): Promise<PostRow> {
  const [post] = await blogService(container).listBlogPosts({ id }, { relations: POST_RELATIONS })
  if (!post) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Blog post with id: ${id} was not found`)
  }
  return post as unknown as PostRow
}

async function assertSlugFree(container: MedusaContainer, kind: "post" | "category" | "tag", slug: string, selfId?: string) {
  const svc = blogService(container)
  const rows =
    kind === "post"
      ? await svc.listBlogPosts({ slug }, { select: ["id"] })
      : kind === "category"
        ? await svc.listBlogCategories({ slug }, { select: ["id"] })
        : await svc.listBlogTags({ slug }, { select: ["id"] })
  if (rows.some((r) => r.id !== selfId)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `slug "${slug}" is already used by another ${kind}`)
  }
}

async function assertPillar(container: MedusaContainer, pillarId: string) {
  const [pillar] = await blogService(container).listBlogPosts({ id: pillarId }, { select: ["id", "type"] })
  if (!pillar) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `pillar_id ${pillarId}: no such post`)
  }
  if (pillar.type !== "pillar") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `pillar_id ${pillarId}: that post is a cluster, not a pillar`)
  }
}

async function assertTermsExist(container: MedusaContainer, kind: "category" | "tag", ids: string[] | undefined) {
  if (!ids?.length) return
  const unique = [...new Set(ids)]
  const svc = blogService(container)
  const rows =
    kind === "category"
      ? await svc.listBlogCategories({ id: unique }, { select: ["id"] })
      : await svc.listBlogTags({ id: unique }, { select: ["id"] })
  const found = new Set(rows.map((r) => r.id))
  const unknown = unique.filter((id) => !found.has(id))
  if (unknown.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `unknown ${kind} id(s): ${unknown.join(", ")}`)
  }
}

async function clusterCount(container: MedusaContainer, pillarId: string) {
  const [, count] = await blogService(container).listAndCountBlogPosts({ pillar_id: pillarId }, { select: ["id"], take: 1 })
  return count
}

export async function createPost(container: MedusaContainer, input: PostCreateInput, now = new Date()) {
  const next = nextPostState(null, input, now)
  await assertSlugFree(container, "post", next.slug)
  if (next.type === "cluster") await assertPillar(container, next.pillar_id as string)
  await assertTermsExist(container, "category", input.category_ids)
  await assertTermsExist(container, "tag", input.tag_ids)
  const created = await blogService(container).createBlogPosts({
    ...next,
    categories: [...new Set(input.category_ids ?? [])],
    tags: [...new Set(input.tag_ids ?? [])],
  } as any)
  return retrievePost(container, (created as unknown as { id: string }).id)
}

export async function updatePost(container: MedusaContainer, id: string, patch: PostUpdateInput, now = new Date()) {
  const current = await retrievePost(container, id)
  const next = nextPostState(current, patch, now)
  if (next.slug !== current.slug) await assertSlugFree(container, "post", next.slug, id)
  if (next.type === "cluster" && next.pillar_id !== current.pillar_id) await assertPillar(container, next.pillar_id as string)
  if (current.type === "pillar" && next.type === "cluster") {
    const n = await clusterCount(container, id)
    if (n > 0) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `this pillar still has ${n} cluster post(s); move them to another pillar first`)
    }
  }
  await assertTermsExist(container, "category", patch.category_ids)
  await assertTermsExist(container, "tag", patch.tag_ids)
  const update: Record<string, unknown> = { ...changedColumns(current, next) }
  if (patch.category_ids) update.categories = [...new Set(patch.category_ids)]
  if (patch.tag_ids) update.tags = [...new Set(patch.tag_ids)]
  if (Object.keys(update).length) {
    await blogService(container).updateBlogPosts({ id, ...update } as any)
  }
  return { before: current, after: await retrievePost(container, id) }
}

export async function deletePost(container: MedusaContainer, id: string) {
  const current = await retrievePost(container, id)
  if (current.type === "pillar") {
    const n = await clusterCount(container, id)
    if (n > 0) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `this pillar still has ${n} cluster post(s); move or delete them first`)
    }
  }
  await blogService(container).deleteBlogPosts(id)
  return current
}

// Categories and tags: names are public (Store API), so they pass the compliance gate too.
export async function createTerm(container: MedusaContainer, kind: "category" | "tag", input: TermCreateInput) {
  assertNoBannedClaims({ name: input.name })
  await assertSlugFree(container, kind, input.slug)
  const svc = blogService(container)
  const row = kind === "category" ? await svc.createBlogCategories(input) : await svc.createBlogTags(input)
  return termOut(row as Term)
}

export async function updateTerm(container: MedusaContainer, kind: "category" | "tag", id: string, patch: TermUpdateInput) {
  const current = await retrieveTerm(container, kind, id)
  if (patch.name !== undefined) assertNoBannedClaims({ name: patch.name })
  if (patch.slug !== undefined && patch.slug !== current.slug) await assertSlugFree(container, kind, patch.slug, id)
  const svc = blogService(container)
  const row = kind === "category" ? await svc.updateBlogCategories({ id, ...patch }) : await svc.updateBlogTags({ id, ...patch })
  return termOut(row as Term)
}

export async function retrieveTerm(container: MedusaContainer, kind: "category" | "tag", id: string) {
  const svc = blogService(container)
  const [row] = kind === "category" ? await svc.listBlogCategories({ id }) : await svc.listBlogTags({ id })
  if (!row) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Blog ${kind} with id: ${id} was not found`)
  }
  return termOut(row as Term)
}

export async function deleteTerm(container: MedusaContainer, kind: "category" | "tag", id: string) {
  await retrieveTerm(container, kind, id)
  const svc = blogService(container)
  if (kind === "category") await svc.deleteBlogCategories(id)
  else await svc.deleteBlogTags(id)
}

export async function listTerms(container: MedusaContainer, kind: "category" | "tag", q: { limit: number; offset: number; q?: string }) {
  const svc = blogService(container)
  const filters = q.q ? { $or: [{ name: { $ilike: `%${escapeLike(q.q)}%` } }, { slug: { $ilike: `%${escapeLike(q.q)}%` } }] } : {}
  const config = { take: q.limit, skip: q.offset, order: { name: "ASC" as const } }
  const [rows, count] =
    kind === "category" ? await svc.listAndCountBlogCategories(filters, config) : await svc.listAndCountBlogTags(filters, config)
  return { rows: (rows as Term[]).map(termOut), count }
}

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
