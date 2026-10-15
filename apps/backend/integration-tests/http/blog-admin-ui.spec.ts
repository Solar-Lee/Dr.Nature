// [P6-02] The blog admin pages' calls (src/admin/lib/blog-api.ts, the same functions the pages
// use) run against the real admin API as a content_editor: create a draft, publish it, and the
// post appears in GET /store/blog/posts; a scheduled post does not; other roles are refused.
//
// What these tests cannot prove: the React pages themselves in a browser (the admin build is
// checked with "medusa build" + a grep of the bundle, see the P6-02 commit), and the storefront
// half of the DEV_PLAN acceptance ("前台出現"), which waits for P7 / P6-03.
//
// Run: cd apps/backend && ../../infra/test-env.sh env TEST_TYPE=integration:http \
//   NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --forceExit integration-tests/http/blog-admin-ui.spec.ts
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { BlogApiError, EMPTY_FORM, blogApi, postToForm, type Fetcher } from "../../src/admin/lib/blog-api"
import { makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const { storeHeaders, superAdminHeaders } = makeCheckoutHelpers({ api, getContainer })

    beforeAll(async () => {
      await runAllSeeds(getContainer())
    })

    // The pages' fetcher, with a bearer token instead of the browser session.
    const fetcherFor = (headers: Record<string, string>): Fetcher => async (path, init = {}) => {
      const method = (init.method ?? "GET").toLowerCase()
      const opts = { headers, validateStatus: () => true }
      const r = method === "post" ? await api.post(path, init.body ?? {}, opts) : method === "delete" ? await api.delete(path, opts) : await api.get(path, opts)
      if (r.status >= 300) throw new BlogApiError(r.data?.message ?? `HTTP ${r.status}`, r.status, r.data?.terms ?? [], r.data?.hits ?? [])
      return r.data
    }
    const storeSlugs = async () => {
      const { data } = await api.get("/store/blog/posts", { headers: await storeHeaders() })
      return data.posts.map((p: any) => p.slug)
    }

    it("a content editor creates a draft, publishes it, and it appears in the store", async () => {
      const ui = blogApi(fetcherFor(await superAdminHeaders("ui-editor@drn.test", "content_editor")))
      const cat = await ui.createTerm("categories", { name: "腸道保養", slug: "gut-care" })
      expect((await ui.listTerms("categories")).map((c) => c.slug)).toEqual(["gut-care"])

      const draft = await ui.createPost({
        ...EMPTY_FORM,
        title: "好菌入門",
        slug: "probiotics-101",
        excerpt: "從飲食開始",
        body_markdown: "# 好菌入門\n\n幫助消化，**每天**一點。",
        meta_title: "好菌入門｜Dr.Nature",
        category_ids: [cat.id],
      })
      expect(draft).toMatchObject({ status: "draft", visibility: "draft", published_at: null })
      expect(await storeSlugs()).toEqual([])

      const initial = postToForm(draft)
      const live = await ui.updatePost(draft.id, { ...initial, status: "published" }, initial)
      expect(live).toMatchObject({ status: "published", visibility: "published" })
      expect(await storeSlugs()).toEqual(["probiotics-101"])
      const { data } = await api.get("/store/blog/posts/probiotics-101", { headers: await storeHeaders() })
      expect(data.post).toMatchObject({ title: "好菌入門", excerpt: "從飲食開始", meta_title: "好菌入門｜Dr.Nature", categories: [{ slug: "gut-care" }] })
      expect(data.post.body_markdown).toEqual("# 好菌入門\n\n幫助消化，**每天**一點。")

      // Editing the published post later keeps its publish time (not re-sent by the page).
      const again = postToForm(live)
      const edited = await ui.updatePost(live.id, { ...again, title: "好菌入門（更新）" }, again)
      expect(edited.published_at).toEqual(live.published_at)

      // Listing in the admin (the list page's call).
      const list = await ui.listPosts({ status: "published", limit: 20, offset: 0 })
      expect(list.posts.map((p) => p.slug)).toEqual(["probiotics-101"])
    })

    it("scheduling: a future publish time keeps the post out of the store", async () => {
      const ui = blogApi(fetcherFor(await superAdminHeaders("ui-editor2@drn.test", "content_editor")))
      const future = new Date(Date.now() + 3 * 24 * 3600 * 1000)
      const pad = (n: number) => String(n).padStart(2, "0")
      const local = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`
      const post = await ui.createPost({ ...EMPTY_FORM, title: "排程文章", slug: "scheduled", status: "published", published_at_local: local })
      expect(post.visibility).toEqual("scheduled")
      expect(await storeSlugs()).toEqual([])
      // A cluster picks its pillar from the pillar list (the form's call).
      const pillars = await ui.listPosts({ type: "pillar", limit: 100 })
      expect(pillars.posts.map((p) => p.slug)).toEqual(["scheduled"])
      const cluster = await ui.createPost({ ...EMPTY_FORM, title: "子題", slug: "child", type: "cluster", pillar_id: pillars.posts[0].id })
      expect(cluster.pillar).toMatchObject({ slug: "scheduled" })
      // The edit page can delete a cluster, but not a pillar that still has one.
      await expect(ui.deletePost(post.id)).rejects.toMatchObject({ status: 400 })
      await ui.deletePost(cluster.id)
      await ui.deletePost(post.id)
      expect((await ui.listPosts()).count).toEqual(0)
    })

    it("a banned term reaches the page as a list of terms; other roles get 403", async () => {
      const ui = blogApi(fetcherFor(await superAdminHeaders("ui-editor3@drn.test", "content_editor")))
      const error = await ui
        .createPost({ ...EMPTY_FORM, title: "改善便秘", slug: "bad", status: "published" })
        .then(() => null, (e: BlogApiError) => e)
      expect(error).toBeInstanceOf(BlogApiError)
      expect(error).toMatchObject({ status: 400, terms: ["便秘"] })
      expect(error!.hits[0]).toMatchObject({ field: "title", term: "便秘", line: 1, column: 3 })

      const ops = blogApi(fetcherFor(await superAdminHeaders("ui-ops@drn.test", "operations")))
      await expect(ops.listPosts()).rejects.toMatchObject({ status: 403 })
      await expect(ops.createPost({ ...EMPTY_FORM, title: "x", slug: "x" })).rejects.toMatchObject({ status: 403 })
    })
  },
})
