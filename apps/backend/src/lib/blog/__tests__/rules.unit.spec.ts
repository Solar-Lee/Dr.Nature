// [P6-01] Blog rules without a database: request shapes, visibility, publishing, pillar / cluster.
// The database checks (slug taken, pillar exists, a pillar's clusters) are in the integration
// spec integration-tests/http/blog.spec.ts.
import { BlogClaimsError } from "../claims"
import {
  POST_CREATE_SCHEMA,
  POST_UPDATE_SCHEMA,
  STORE_LIST_QUERY,
  TERM_CREATE_SCHEMA,
  changedColumns,
  nextPostState,
  parseOrThrow,
  visibilityOf,
  type PostState,
} from "../rules"

const NOW = new Date("2026-10-14T08:00:00.000Z")
const draft = (over: Partial<PostState> = {}): PostState => ({
  id: "bpost_1",
  title: "腸道菌叢入門",
  slug: "gut-basics",
  type: "pillar",
  pillar_id: null,
  excerpt: null,
  body_markdown: "幫助消化",
  status: "draft",
  published_at: null,
  author_name: null,
  meta_title: null,
  meta_description: null,
  canonical_url: null,
  og_image_url: null,
  noindex: false,
  ...over,
})

describe("visibility", () => {
  it("draft / scheduled / published", () => {
    expect(visibilityOf({ status: "draft", published_at: "2020-01-01T00:00:00Z" }, NOW)).toEqual("draft")
    expect(visibilityOf({ status: "published", published_at: new Date(NOW.getTime() + 1000) }, NOW)).toEqual("scheduled")
    expect(visibilityOf({ status: "published", published_at: NOW }, NOW)).toEqual("published")
    expect(visibilityOf({ status: "published", published_at: null }, NOW)).toEqual("published")
  })
})

describe("nextPostState", () => {
  it("publishing without a date stamps now; an explicit future date stays (scheduled)", () => {
    expect(nextPostState(draft(), { status: "published" }, NOW).published_at).toEqual(NOW)
    const future = "2026-12-01T00:00:00+08:00"
    const s = nextPostState(draft(), { status: "published", published_at: future }, NOW)
    expect(s.published_at).toEqual(new Date(future))
    expect(visibilityOf(s, NOW)).toEqual("scheduled")
  })

  it("a draft keeps published_at empty", () => {
    expect(nextPostState(null, { title: "t", slug: "t", type: "pillar", body_markdown: "", status: "draft", noindex: false }, NOW).published_at).toBeNull()
  })

  it("a cluster needs a pillar and cannot be its own pillar", () => {
    expect(() => nextPostState(draft(), { type: "cluster" }, NOW)).toThrow(/must reference its pillar/)
    expect(() => nextPostState(draft(), { type: "cluster", pillar_id: "bpost_1" }, NOW)).toThrow(/own pillar/)
    expect(nextPostState(draft(), { type: "cluster", pillar_id: "bpost_2" }, NOW).pillar_id).toEqual("bpost_2")
  })

  it("a pillar has no pillar: explicit pillar_id refused, a former cluster's link is cleared", () => {
    expect(() => nextPostState(draft(), { pillar_id: "bpost_2" }, NOW)).toThrow(/cannot have a pillar/)
    const cluster = draft({ type: "cluster", pillar_id: "bpost_2" })
    expect(nextPostState(cluster, { type: "pillar" }, NOW).pillar_id).toBeNull()
  })

  it("publishing runs the compliance gate on title, excerpt, body and meta fields", () => {
    for (const field of ["title", "excerpt", "body_markdown", "meta_title", "meta_description"] as const) {
      let error: unknown
      try {
        nextPostState(draft(), { status: "published", [field]: "改善便秘" }, NOW)
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(BlogClaimsError)
      expect((error as BlogClaimsError).hits.map((h) => h.field)).toEqual([field])
    }
  })

  it("an already published post is re-checked on every change; drafts and unpublishing are not", () => {
    const live = draft({ status: "published", published_at: NOW })
    expect(() => nextPostState(live, { excerpt: "治療" }, NOW)).toThrow(BlogClaimsError)
    expect(() => nextPostState(draft(), { body_markdown: "治療" }, NOW)).not.toThrow()
    expect(nextPostState(draft({ status: "published", body_markdown: "治療" }), { status: "draft" }, NOW).status).toEqual("draft")
  })
})

describe("changedColumns", () => {
  it("only differing columns (dates by value); everything on create", () => {
    const cur = draft({ status: "published", published_at: new Date(NOW) })
    expect(changedColumns(cur, { ...cur, published_at: new Date(NOW), title: "新標題" })).toEqual({ title: "新標題" })
    expect(Object.keys(changedColumns(null, cur))).toHaveLength(14)
  })
})

describe("schemas", () => {
  const ok = { title: "標題", slug: "a-b-1", type: "pillar" }
  it("create: defaults and strict keys", () => {
    expect(parseOrThrow(POST_CREATE_SCHEMA, ok)).toMatchObject({ status: "draft", body_markdown: "", noindex: false })
    expect(() => parseOrThrow(POST_CREATE_SCHEMA, { ...ok, visibility: "published" })).toThrow()
    expect(() => parseOrThrow(POST_UPDATE_SCHEMA, { id: "x" })).toThrow()
  })
  it("slugs are lower-case kebab", () => {
    for (const bad of ["A-b", "a--b", "-a", "a_b", "腸道", "a b", ""]) {
      expect(() => parseOrThrow(TERM_CREATE_SCHEMA, { name: "n", slug: bad })).toThrow(/slug/)
    }
  })
  it("canonical / OG URLs must be http(s)", () => {
    expect(() => parseOrThrow(POST_UPDATE_SCHEMA, { canonical_url: "javascript:alert(1)" })).toThrow(/http/)
    expect(() => parseOrThrow(POST_UPDATE_SCHEMA, { og_image_url: "ftp://x/y.png" })).toThrow(/http/)
    expect(parseOrThrow(POST_UPDATE_SCHEMA, { canonical_url: "https://dr.nature.smilelife.tw/blog/a" }).canonical_url).toBeTruthy()
  })
  it("published_at needs an ISO date-time", () => {
    expect(() => parseOrThrow(POST_UPDATE_SCHEMA, { published_at: "2026-10-14" })).toThrow(/published_at/)
    expect(parseOrThrow(POST_UPDATE_SCHEMA, { published_at: "2026-10-14T09:00:00+08:00" }).published_at).toBeTruthy()
  })
  it("store list query: limit 1..100, default 20", () => {
    expect(parseOrThrow(STORE_LIST_QUERY, {})).toMatchObject({ limit: 20, offset: 0 })
    expect(() => parseOrThrow(STORE_LIST_QUERY, { limit: "101" })).toThrow(/limit/)
    expect(() => parseOrThrow(STORE_LIST_QUERY, { offset: "-1" })).toThrow(/offset/)
  })
})
