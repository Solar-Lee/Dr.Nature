// [P6-02] What the blog admin pages send to the admin API (src/api/admin/blog/**), as plain
// functions over an injected JSON fetcher: the pages pass a same-origin fetch (the admin signs
// in with a session cookie; Medusa 2.21.2 dashboard default auth type "session"), and
// integration-tests/http/blog-admin-ui.spec.ts runs the same calls with a content_editor token.

export type Fetcher = (path: string, init?: { method?: string; body?: unknown }) => Promise<any>

export type Term = { id: string; name: string; slug: string }
export type AdminPost = {
  id: string
  title: string
  slug: string
  type: "pillar" | "cluster"
  pillar_id: string | null
  excerpt: string | null
  body_markdown: string
  status: "draft" | "published"
  published_at: string | null
  visibility: "draft" | "scheduled" | "published"
  author_name: string | null
  meta_title: string | null
  meta_description: string | null
  canonical_url: string | null
  og_image_url: string | null
  noindex: boolean
  updated_at: string
  pillar: { id: string; title: string; slug: string } | null
  clusters?: { id: string; title: string; slug: string; visibility: string }[]
  categories: Term[]
  tags: Term[]
}

// Form state: text inputs hold strings ("" = empty); published_at_local is a
// <input type="datetime-local"> value in the editor's own time zone ("" = when published).
export type PostForm = {
  title: string
  slug: string
  type: "pillar" | "cluster"
  pillar_id: string
  excerpt: string
  body_markdown: string
  status: "draft" | "published"
  published_at_local: string
  author_name: string
  meta_title: string
  meta_description: string
  canonical_url: string
  og_image_url: string
  noindex: boolean
  category_ids: string[]
  tag_ids: string[]
}

export const EMPTY_FORM: PostForm = {
  title: "",
  slug: "",
  type: "pillar",
  pillar_id: "",
  excerpt: "",
  body_markdown: "",
  status: "draft",
  published_at_local: "",
  author_name: "",
  meta_title: "",
  meta_description: "",
  canonical_url: "",
  og_image_url: "",
  noindex: false,
  category_ids: [],
  tag_ids: [],
}

const pad = (n: number) => String(n).padStart(2, "0")
// ISO instant -> "YYYY-MM-DDTHH:mm" in the browser's time zone (what datetime-local shows).
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
// datetime-local value (local time) -> ISO instant; "" -> null.
export function localInputToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) throw new Error(`發佈時間格式不正確：${local}`)
  return d.toISOString()
}

export function postToForm(p: AdminPost): PostForm {
  return {
    title: p.title,
    slug: p.slug,
    type: p.type,
    pillar_id: p.pillar_id ?? "",
    excerpt: p.excerpt ?? "",
    body_markdown: p.body_markdown,
    status: p.status,
    published_at_local: isoToLocalInput(p.published_at),
    author_name: p.author_name ?? "",
    meta_title: p.meta_title ?? "",
    meta_description: p.meta_description ?? "",
    canonical_url: p.canonical_url ?? "",
    og_image_url: p.og_image_url ?? "",
    noindex: p.noindex,
    category_ids: p.categories.map((c) => c.id),
    tag_ids: p.tags.map((t) => t.id),
  }
}

const orNull = (s: string) => (s.trim() ? s.trim() : null)

// The request body for POST /admin/blog/posts (create) or /admin/blog/posts/:id (update).
// With `initial` (the form as loaded), an untouched publish time is not sent: the input only has
// minute precision, so re-sending it would move a published post's date by up to 59 seconds.
export function formToPayload(f: PostForm, initial?: PostForm) {
  const keepDate = initial !== undefined && initial.published_at_local === f.published_at_local
  return {
    title: f.title.trim(),
    slug: f.slug.trim(),
    type: f.type,
    pillar_id: f.type === "cluster" ? orNull(f.pillar_id) : null,
    excerpt: orNull(f.excerpt),
    body_markdown: f.body_markdown,
    status: f.status,
    published_at: keepDate ? undefined : localInputToIso(f.published_at_local),
    author_name: orNull(f.author_name),
    meta_title: orNull(f.meta_title),
    meta_description: orNull(f.meta_description),
    canonical_url: orNull(f.canonical_url),
    og_image_url: orNull(f.og_image_url),
    noindex: f.noindex,
    category_ids: f.category_ids,
    tag_ids: f.tag_ids,
  }
}

export function blogApi(fetchJson: Fetcher) {
  const qs = (q: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v))
    const s = p.toString()
    return s ? `?${s}` : ""
  }
  return {
    listPosts: (q: { q?: string; status?: string; type?: string; limit?: number; offset?: number } = {}) =>
      fetchJson(`/admin/blog/posts${qs(q)}`) as Promise<{ posts: AdminPost[]; count: number; limit: number; offset: number }>,
    getPost: async (id: string) => (await fetchJson(`/admin/blog/posts/${encodeURIComponent(id)}`)).post as AdminPost,
    createPost: async (f: PostForm) => (await fetchJson("/admin/blog/posts", { method: "POST", body: formToPayload(f) })).post as AdminPost,
    updatePost: async (id: string, f: PostForm, initial?: PostForm) =>
      (await fetchJson(`/admin/blog/posts/${encodeURIComponent(id)}`, { method: "POST", body: formToPayload(f, initial) })).post as AdminPost,
    deletePost: (id: string) => fetchJson(`/admin/blog/posts/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listTerms: async (kind: "categories" | "tags") => (await fetchJson(`/admin/blog/${kind}?limit=200`))[kind] as Term[],
    createTerm: async (kind: "categories" | "tags", t: { name: string; slug: string }) => {
      const r = await fetchJson(`/admin/blog/${kind}`, { method: "POST", body: { name: t.name.trim(), slug: t.slug.trim() } })
      return (kind === "categories" ? r.category : r.tag) as Term
    },
    deleteTerm: (kind: "categories" | "tags", id: string) => fetchJson(`/admin/blog/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  }
}

// Error raised for a non-2xx answer; `terms` / `hits` are set for BLOG_BANNED_TERMS.
export class BlogApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly terms: string[] = [],
    readonly hits: { field: string; term: string; reason: string; line: number; column: number }[] = []
  ) {
    super(message)
  }
}

// Same-origin fetch for the admin pages (session cookie).
export const browserFetch: Fetcher = async (path, init = {}) => {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new BlogApiError(data?.message ?? `HTTP ${res.status}`, res.status, data?.terms ?? [], data?.hits ?? [])
  }
  return data
}

export const FIELD_LABELS: Record<string, string> = {
  title: "標題",
  excerpt: "摘要",
  body_markdown: "內文",
  meta_title: "SEO 標題",
  meta_description: "SEO 描述",
  name: "名稱",
}
