// [P6-01] Blog rules that need no database: request schemas, visibility, publishing and the
// pillar / cluster shape. src/lib/blog/admin.ts applies them; unit tests in __tests__.
//
//  - type "pillar": no pillar of its own (pillar_id is cleared when a cluster becomes a pillar;
//    an explicit pillar_id on a pillar is rejected);
//  - type "cluster": pillar_id required, pointing to an existing post of type "pillar" (checked
//    against the database in admin.ts), never itself;
//  - status "published" without published_at gets published_at = now; a published post whose
//    published_at is in the future is "scheduled" (not in the Store API until then);
//  - whatever the post looks like after the change, if it is published its title, excerpt, body
//    and meta fields must pass the compliance gate (claims.ts).
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { assertNoBannedClaims } from "./claims"

export const POST_TYPES = ["pillar", "cluster"] as const
export const POST_STATUSES = ["draft", "published"] as const
export type PostType = (typeof POST_TYPES)[number]
export type PostStatus = (typeof POST_STATUSES)[number]
export type Visibility = "draft" | "scheduled" | "published"

// URL-safe slug (same shape as product handles, scripts/__tests__/catalog.test.mjs).
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SLUG = z.string().trim().max(120).regex(SLUG_RE, "lower-case letters, digits and single hyphens (e.g. gut-health-basics)")
const URL_HTTP = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      return ["http:", "https:"].includes(new URL(v).protocol)
    } catch {
      return false
    }
  }, "must be an http(s) URL")
const TEXT = (max: number) => z.string().trim().max(max)
const IDS = z.array(z.string().min(1)).max(50)

const POST_FIELDS = {
  title: TEXT(200).min(1),
  slug: SLUG,
  type: z.enum(POST_TYPES),
  pillar_id: z.string().min(1).nullable(),
  excerpt: TEXT(1000).nullable(),
  body_markdown: z.string().max(200_000),
  status: z.enum(POST_STATUSES),
  published_at: z.iso.datetime({ offset: true }).nullable(),
  author_name: TEXT(100).nullable(),
  meta_title: TEXT(200).nullable(),
  meta_description: TEXT(1000).nullable(),
  canonical_url: URL_HTTP.nullable(),
  og_image_url: URL_HTTP.nullable(),
  noindex: z.boolean(),
  category_ids: IDS,
  tag_ids: IDS,
}

export const POST_CREATE_SCHEMA = z
  .object({
    ...POST_FIELDS,
    pillar_id: POST_FIELDS.pillar_id.optional(),
    excerpt: POST_FIELDS.excerpt.optional(),
    body_markdown: POST_FIELDS.body_markdown.default(""),
    status: POST_FIELDS.status.default("draft"),
    published_at: POST_FIELDS.published_at.optional(),
    author_name: POST_FIELDS.author_name.optional(),
    meta_title: POST_FIELDS.meta_title.optional(),
    meta_description: POST_FIELDS.meta_description.optional(),
    canonical_url: POST_FIELDS.canonical_url.optional(),
    og_image_url: POST_FIELDS.og_image_url.optional(),
    noindex: POST_FIELDS.noindex.default(false),
    category_ids: IDS.optional(),
    tag_ids: IDS.optional(),
  })
  .strict()
export type PostCreateInput = z.infer<typeof POST_CREATE_SCHEMA>

// Partial update: omitted fields stay, null clears a nullable field, *_ids replace the set.
export const POST_UPDATE_SCHEMA = z.object(POST_FIELDS).partial().strict()
export type PostUpdateInput = z.infer<typeof POST_UPDATE_SCHEMA>

export const TERM_CREATE_SCHEMA = z.object({ name: TEXT(100).min(1), slug: SLUG }).strict()
export const TERM_UPDATE_SCHEMA = TERM_CREATE_SCHEMA.partial().strict()
export type TermCreateInput = z.infer<typeof TERM_CREATE_SCHEMA>
export type TermUpdateInput = z.infer<typeof TERM_UPDATE_SCHEMA>

const LIMIT = z.coerce.number().int().min(1).max(100).default(20)
const OFFSET = z.coerce.number().int().min(0).default(0)
export const STORE_LIST_QUERY = z.object({
  limit: LIMIT,
  offset: OFFSET,
  category: SLUG.optional(),
  tag: SLUG.optional(),
  type: z.enum(POST_TYPES).optional(),
})
export const ADMIN_POST_LIST_QUERY = z.object({
  limit: LIMIT,
  offset: OFFSET,
  q: z.string().trim().max(200).optional(),
  status: z.enum(POST_STATUSES).optional(),
  type: z.enum(POST_TYPES).optional(),
  pillar_id: z.string().min(1).optional(),
})
export const ADMIN_TERM_LIST_QUERY = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: OFFSET,
  q: z.string().trim().max(200).optional(),
})

// Zod issues -> one 400 message, like src/api/admin/promotion-templates/route.ts.
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")
    )
  }
  return parsed.data
}

export function visibilityOf(post: { status: string; published_at: Date | string | null }, now: Date): Visibility {
  if (post.status !== "published") return "draft"
  return post.published_at && new Date(post.published_at).getTime() > now.getTime() ? "scheduled" : "published"
}

// Store filter: published and published_at <= now (MikroORM operator, as Medusa core uses).
export const visibleFilter = (now: Date) => ({ status: "published", published_at: { $lte: now } })

// The scalar state of a post that the rules look at.
export type PostState = {
  id?: string
  title: string
  slug: string
  type: PostType
  pillar_id: string | null
  excerpt: string | null
  body_markdown: string
  status: PostStatus
  published_at: Date | null
  author_name: string | null
  meta_title: string | null
  meta_description: string | null
  canonical_url: string | null
  og_image_url: string | null
  noindex: boolean
}

const SCALAR_KEYS = [
  "title",
  "slug",
  "type",
  "pillar_id",
  "excerpt",
  "body_markdown",
  "status",
  "published_at",
  "author_name",
  "meta_title",
  "meta_description",
  "canonical_url",
  "og_image_url",
  "noindex",
] as const

// The post after applying `patch` to `current` (null = create). Normalises published_at and the
// pillar link and runs the shape checks and the compliance gate; database checks (slug, pillar
// exists, clusters of a pillar) are admin.ts's.
export function nextPostState(current: PostState | null, patch: PostUpdateInput | PostCreateInput, now: Date): PostState {
  const base: PostState = current ?? {
    title: "",
    slug: "",
    type: "pillar",
    pillar_id: null,
    excerpt: null,
    body_markdown: "",
    status: "draft",
    published_at: null,
    author_name: null,
    meta_title: null,
    meta_description: null,
    canonical_url: null,
    og_image_url: null,
    noindex: false,
  }
  const next: PostState = { ...base }
  for (const key of SCALAR_KEYS) {
    const v = (patch as Record<string, unknown>)[key]
    if (v === undefined) continue
    ;(next as Record<string, unknown>)[key] = key === "published_at" && v !== null ? new Date(v as string) : v
  }
  if (next.type === "pillar") {
    if (patch.pillar_id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "a pillar post cannot have a pillar (pillar_id must be empty)")
    }
    next.pillar_id = null
  } else {
    if (!next.pillar_id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "a cluster post must reference its pillar (pillar_id)")
    }
    if (current?.id && next.pillar_id === current.id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "a post cannot be its own pillar")
    }
  }
  if (next.status === "published" && !next.published_at) {
    next.published_at = now
  }
  if (next.status === "published") {
    assertNoBannedClaims({
      title: next.title,
      excerpt: next.excerpt,
      body_markdown: next.body_markdown,
      meta_title: next.meta_title,
      meta_description: next.meta_description,
    })
  }
  return next
}

// Only the scalar columns that differ from `current` (all of them on create).
export function changedColumns(current: PostState | null, next: PostState): Partial<PostState> {
  const out: Record<string, unknown> = {}
  for (const key of SCALAR_KEYS) {
    const a = current?.[key]
    const b = next[key]
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b
    if (!current || !same) out[key] = b
  }
  return out as Partial<PostState>
}
