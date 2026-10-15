// [P6-02] Form <-> API mapping of the blog editor (lib/blog-api.ts). The same functions are used
// against the real API in integration-tests/http/blog-admin-ui.spec.ts.
import { EMPTY_FORM, formToPayload, isoToLocalInput, localInputToIso, postToForm, type AdminPost } from "../blog-api"

const post: AdminPost = {
  id: "bpost_1",
  title: "T",
  slug: "t",
  type: "cluster",
  pillar_id: "bpost_p",
  excerpt: null,
  body_markdown: "b",
  status: "published",
  published_at: "2026-10-14T08:00:12.345Z",
  visibility: "published",
  author_name: null,
  meta_title: "M",
  meta_description: null,
  canonical_url: null,
  og_image_url: null,
  noindex: true,
  updated_at: "2026-10-14T08:00:12.345Z",
  pillar: { id: "bpost_p", title: "P", slug: "p" },
  categories: [{ id: "bcat_1", name: "c", slug: "c" }],
  tags: [],
}

describe("blog editor mapping", () => {
  it("empty texts become null, a pillar never sends a pillar, empty publish time = now (null)", () => {
    const body = formToPayload({ ...EMPTY_FORM, title: " 標題 ", slug: " a-b ", pillar_id: "bpost_x", excerpt: "  " })
    expect(body).toEqual({
      title: "標題",
      slug: "a-b",
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
      category_ids: [],
      tag_ids: [],
    })
  })

  it("an edited post round-trips; an untouched publish time is not re-sent", () => {
    const form = postToForm(post)
    expect(form).toMatchObject({ type: "cluster", pillar_id: "bpost_p", excerpt: "", meta_title: "M", noindex: true, category_ids: ["bcat_1"] })
    const body = formToPayload({ ...form, title: "T2" }, form)
    expect(body.published_at).toBeUndefined()
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty("published_at")
    expect(body).toMatchObject({ title: "T2", pillar_id: "bpost_p", excerpt: null })
    // A changed time is sent as an ISO instant; clearing it sends null (= publish now).
    const later = formToPayload({ ...form, published_at_local: "2026-12-01T09:30" }, form)
    expect(later.published_at).toEqual(new Date("2026-12-01T09:30").toISOString())
    expect(formToPayload({ ...form, published_at_local: "" }, form).published_at).toBeNull()
  })

  it("datetime-local conversion keeps the minute in the browser's time zone", () => {
    const local = isoToLocalInput("2026-10-14T08:00:12.345Z")
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(localInputToIso(local)).toEqual("2026-10-14T08:00:00.000Z")
    expect(isoToLocalInput(null)).toEqual("")
    expect(localInputToIso("")).toBeNull()
    expect(() => localInputToIso("not a date")).toThrow(/格式不正確/)
  })
})
