// [P6-01] Blog module acceptance (DEV_PLAN P6-01): a pillar and two clusters created through the
// admin API are linked both ways in the Store API; drafts and scheduled posts are invisible; a
// cluster without a pillar is refused; roles without blog policies get 403; a banned term
// (docs/compliance/claims.json) blocks publishing with the list of terms.
//
// What these tests cannot prove: how the storefront renders the posts (P6-03 / P7), and that the
// claims list itself is complete (docs/compliance/claims.md).
//
// Run: cd apps/backend && ../../infra/test-env.sh env TEST_TYPE=integration:http \
//   NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --forceExit integration-tests/http/blog.spec.ts
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { IRbacModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, generateJwtToken } from "@medusajs/framework/utils"
import drnBlogRbac from "../../src/migration-scripts/drn-0008-blog-rbac"
import { BLOG_POLICY_KEYS } from "../../src/lib/blog/policies"
import { CONTENT_EDITOR_DESCRIPTION, CONTENT_EDITOR_DESCRIPTION_BEFORE_P6 } from "../../src/lib/rbac-roles"
import { createRbacRolesWorkflow } from "@medusajs/medusa/core-flows"
import { makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"

jest.setTimeout(180 * 1000)

const PAST = (day: number) => `2026-01-${String(day).padStart(2, "0")}T09:00:00+08:00`

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const { storeHeaders, superAdminHeaders } = makeCheckoutHelpers({ api, getContainer })
    let n = 0
    const asRole = (role: string) => superAdminHeaders(`blog-${role.replace(/\W/g, "")}-${++n}@drn.test`, role)
    const call = async (method: "get" | "post" | "delete", url: string, headers: Record<string, string>, body?: unknown) => {
      const opts = { headers, validateStatus: () => true }
      return method === "post" ? api.post(url, body ?? {}, opts) : api[method](url, opts)
    }

    beforeAll(async () => {
      await runAllSeeds(getContainer())
    })

    // Creates a post as a content editor; fails the test on anything but 201.
    const createPost = async (editor: Record<string, string>, body: Record<string, unknown>) => {
      const r = await call("post", "/admin/blog/posts", editor, body)
      if (r.status !== 201) throw new Error(`create post ${r.status}: ${JSON.stringify(r.data)}`)
      return r.data.post
    }
    const storeGet = async (url: string) => call("get", url, await storeHeaders())

    it("pillar + 2 clusters: the store links the pillar to both clusters and each cluster to the pillar", async () => {
      const editor = await asRole("content_editor")
      const pillar = await createPost(editor, { title: "腸道保養總整理", slug: "gut-guide", type: "pillar", status: "published", published_at: PAST(1) })
      const c1 = await createPost(editor, { title: "膳食纖維怎麼吃", slug: "fiber", type: "cluster", pillar_id: pillar.id, status: "published", published_at: PAST(2) })
      const c2 = await createPost(editor, { title: "好菌與飲食", slug: "probiotic-diet", type: "cluster", pillar_id: pillar.id, status: "published", published_at: PAST(3) })

      const p = await storeGet("/store/blog/posts/gut-guide")
      expect(p.status).toEqual(200)
      expect(p.data.post).toMatchObject({ slug: "gut-guide", type: "pillar", pillar: null })
      expect(p.data.post.clusters.map((c: any) => c.slug)).toEqual(["probiotic-diet", "fiber"])
      for (const [slug, id] of [["fiber", c1.id], ["probiotic-diet", c2.id]]) {
        const c = await storeGet(`/store/blog/posts/${slug}`)
        expect(c.status).toEqual(200)
        expect(c.data.post).toMatchObject({ id, type: "cluster", clusters: [] })
        expect(c.data.post.pillar).toMatchObject({ id: pillar.id, slug: "gut-guide", title: "腸道保養總整理" })
      }
      const list = await storeGet("/store/blog/posts")
      expect(list.data.posts.map((x: any) => x.slug)).toEqual(["probiotic-diet", "fiber", "gut-guide"])
      expect(list.data.count).toEqual(3)
      // The admin view shows the same links.
      const admin = await call("get", `/admin/blog/posts/${pillar.id}`, editor)
      expect(admin.data.post.clusters.map((c: any) => c.id).sort()).toEqual([c1.id, c2.id].sort())
    })

    it("drafts and scheduled posts are invisible to the store (lists, by slug, as pillar or cluster)", async () => {
      const editor = await asRole("content_editor")
      const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
      const draftPillar = await createPost(editor, { title: "草稿 pillar", slug: "draft-pillar", type: "pillar" })
      const livePillar = await createPost(editor, { title: "上線 pillar", slug: "live-pillar", type: "pillar", status: "published", published_at: PAST(1) })
      await createPost(editor, { title: "上線 cluster", slug: "live-cluster", type: "cluster", pillar_id: draftPillar.id, status: "published", published_at: PAST(2) })
      await createPost(editor, { title: "排程 cluster", slug: "scheduled-cluster", type: "cluster", pillar_id: livePillar.id, status: "published", published_at: future })
      await createPost(editor, { title: "草稿 cluster", slug: "draft-cluster", type: "cluster", pillar_id: livePillar.id })

      const list = await storeGet("/store/blog/posts?limit=100")
      expect(list.data.posts.map((x: any) => x.slug).sort()).toEqual(["live-cluster", "live-pillar"])
      for (const slug of ["draft-pillar", "scheduled-cluster", "draft-cluster", "no-such-post"]) {
        expect((await storeGet(`/store/blog/posts/${slug}`)).status).toEqual(404)
      }
      expect((await storeGet("/store/blog/posts/live-cluster")).data.post.pillar).toBeNull()
      expect((await storeGet("/store/blog/posts/live-pillar")).data.post.clusters).toEqual([])
      // Unpublishing keeps published_at but hides the post again.
      const unpublished = await call("post", `/admin/blog/posts/${livePillar.id}`, editor, { status: "draft" })
      expect(unpublished.data.post).toMatchObject({ status: "draft", visibility: "draft", published_at: new Date(PAST(1)).toISOString() })
      expect((await storeGet("/store/blog/posts/live-pillar")).status).toEqual(404)
      expect((await storeGet("/store/blog/posts")).data.posts.map((x: any) => x.slug)).toEqual(["live-cluster"])
      // Admin sees all five with their visibility.
      const admin = await call("get", "/admin/blog/posts?limit=100", editor)
      const vis = Object.fromEntries(admin.data.posts.map((x: any) => [x.slug, x.visibility]))
      expect(vis).toEqual({
        "draft-pillar": "draft",
        "live-pillar": "draft",
        "live-cluster": "published",
        "scheduled-cluster": "scheduled",
        "draft-cluster": "draft",
      })
    })

    it("a cluster must reference an existing pillar; a pillar cannot have one", async () => {
      const editor = await asRole("content_editor")
      const pillar = await createPost(editor, { title: "P", slug: "p", type: "pillar" })
      const cluster = await createPost(editor, { title: "C", slug: "c", type: "cluster", pillar_id: pillar.id })
      const tryCreate = (body: Record<string, unknown>) => call("post", "/admin/blog/posts", editor, { title: "X", slug: "x", ...body })
      const noPillar = await tryCreate({ type: "cluster" })
      expect({ status: noPillar.status, message: noPillar.data.message }).toEqual({ status: 400, message: "a cluster post must reference its pillar (pillar_id)" })
      expect((await tryCreate({ type: "cluster", pillar_id: "bpost_missing" })).data.message).toMatch(/no such post/)
      const toCluster = await tryCreate({ type: "cluster", pillar_id: cluster.id })
      expect({ status: toCluster.status, message: toCluster.data.message }).toEqual({ status: 400, message: `pillar_id ${cluster.id}: that post is a cluster, not a pillar` })
      expect((await tryCreate({ type: "pillar", pillar_id: pillar.id })).status).toEqual(400)
      // Updates keep the rule: a cluster cannot drop its pillar or point to a cluster.
      expect((await call("post", `/admin/blog/posts/${cluster.id}`, editor, { pillar_id: null })).status).toEqual(400)
      expect((await call("post", `/admin/blog/posts/${cluster.id}`, editor, { pillar_id: cluster.id })).status).toEqual(400)
      // A pillar with clusters can be neither deleted nor turned into a cluster.
      const other = await createPost(editor, { title: "P2", slug: "p2", type: "pillar" })
      const demote = await call("post", `/admin/blog/posts/${pillar.id}`, editor, { type: "cluster", pillar_id: other.id })
      expect({ status: demote.status, message: demote.data.message }).toEqual({ status: 400, message: "this pillar still has 1 cluster post(s); move them to another pillar first" })
      expect((await call("delete", `/admin/blog/posts/${pillar.id}`, editor)).status).toEqual(400)
      // Move the cluster, then the pillar can go.
      expect((await call("post", `/admin/blog/posts/${cluster.id}`, editor, { pillar_id: other.id })).data.post.pillar.id).toEqual(other.id)
      expect((await call("delete", `/admin/blog/posts/${pillar.id}`, editor)).data).toEqual({ id: pillar.id, object: "blog_post", deleted: true })
      expect((await call("get", `/admin/blog/posts/${pillar.id}`, editor)).status).toEqual(404)
    })

    // A staff user without any role (Medusa 2.21.2 check-permissions: no roles -> 403).
    const noRoleHeaders = async () => {
      const container = getContainer()
      const email = `blog-norole-${++n}@drn.test`
      const user = await container.resolve(Modules.USER).createUsers({ email })
      const identity = await container.resolve(Modules.AUTH).createAuthIdentities({
        provider_identities: [{ provider: "emailpass", entity_id: email }],
        app_metadata: { user_id: user.id },
      })
      const { http } = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig
      const token = generateJwtToken(
        { actor_id: user.id, actor_type: "user", auth_identity_id: identity.id, app_metadata: { user_id: user.id, roles: [] } },
        { secret: http.jwtSecret as string, expiresIn: "1d" }
      )
      return { authorization: `Bearer ${token}` }
    }

    it("roles without blog policies get 403 on every blog admin route; content editors and Super Admin do not", async () => {
      const editor = await asRole("content_editor")
      const post = await createPost(editor, { title: "T", slug: "t", type: "pillar" })
      const cat = (await call("post", "/admin/blog/categories", editor, { name: "腸道", slug: "gut" })).data.category
      const tag = (await call("post", "/admin/blog/tags", editor, { name: "飲食", slug: "diet" })).data.tag
      const routes = (k: string): ["get" | "post" | "delete", string, unknown?][] => [
        ["get", "/admin/blog/posts"],
        ["post", "/admin/blog/posts", { title: "Y", slug: `y-${k}`, type: "pillar" }],
        ["get", `/admin/blog/posts/${post.id}`],
        ["post", `/admin/blog/posts/${post.id}`, { title: `Z ${k}` }],
        ["delete", `/admin/blog/posts/${post.id}`],
        ["get", "/admin/blog/categories"],
        ["post", "/admin/blog/categories", { name: "N", slug: `n-${k}` }],
        ["get", `/admin/blog/categories/${cat.id}`],
        ["post", `/admin/blog/categories/${cat.id}`, { name: `N ${k}` }],
        ["delete", `/admin/blog/categories/${cat.id}`],
        ["get", "/admin/blog/tags"],
        ["post", "/admin/blog/tags", { name: "M", slug: `m-${k}` }],
        ["get", `/admin/blog/tags/${tag.id}`],
        ["post", `/admin/blog/tags/${tag.id}`, { name: `M ${k}` }],
        ["delete", `/admin/blog/tags/${tag.id}`],
      ]
      const denied = [...(await Promise.all(["support", "operations", "finance"].map(asRole))), await noRoleHeaders()]
      for (const [i, headers] of denied.entries()) {
        for (const [method, url, body] of routes(`denied${i}`)) {
          expect([i, method, url, (await call(method, url, headers, body)).status]).toEqual([i, method, url, 403])
        }
      }
      // Nothing was written by the denied roles.
      expect((await call("get", "/admin/blog/posts", editor)).data.posts.map((p: any) => p.title)).toEqual(["T"])
      // The editor and Super Admin can read, create and update everything ...
      for (const [k, headers] of [["editor", editor], ["boss", await asRole("Super Admin")]] as const) {
        for (const [method, url, body] of routes(k).filter(([m]) => m !== "delete")) {
          const status = (await call(method, url, headers, body)).status
          expect([k, method, url, status]).toEqual([k, method, url, method === "post" && !/\/(bpost|bcat|btag)_/.test(url) ? 201 : 200])
        }
      }
      // ... and delete.
      const boss = await asRole("Super Admin")
      for (const [i, [method, url]] of routes("x").filter(([m]) => m === "delete").entries()) {
        expect([url, (await call(method, url, i % 2 ? boss : editor)).status]).toEqual([url, 200])
      }
    })

    it("each blog admin route checks its own operation (read / create / update / delete)", async () => {
      const container = getContainer()
      const editor = await asRole("content_editor")
      const post = await createPost(editor, { title: "T", slug: "t", type: "pillar" })
      const cat = (await call("post", "/admin/blog/categories", editor, { name: "腸道", slug: "gut" })).data.category
      const tag = (await call("post", "/admin/blog/tags", editor, { name: "飲食", slug: "diet" })).data.tag
      const rbac = container.resolve<IRbacModuleService>(Modules.RBAC)
      for (const op of ["read", "create", "update", "delete"]) {
        // A role holding ONLY blog_*:<op>.
        const keys = BLOG_POLICY_KEYS.filter((k) => k.endsWith(`:${op}`))
        const policies = await rbac.listRbacPolicies({ key: keys })
        expect(policies).toHaveLength(3)
        await createRbacRolesWorkflow(container).run({ input: { roles: [{ name: `blog-only-${op}`, policy_ids: policies.map((p) => p.id) }] } })
        const headers = await asRole(`blog-only-${op}`)
        const routes: [string, "get" | "post" | "delete", string, unknown?][] = [
          ["read", "get", "/admin/blog/posts"],
          ["create", "post", "/admin/blog/posts", { title: "Y", slug: `y-${op}`, type: "pillar" }],
          ["read", "get", `/admin/blog/posts/${post.id}`],
          ["update", "post", `/admin/blog/posts/${post.id}`, { title: `T ${op}` }],
          ["delete", "delete", `/admin/blog/posts/${post.id}`],
          ["read", "get", "/admin/blog/categories"],
          ["create", "post", "/admin/blog/categories", { name: "N", slug: `n-${op}` }],
          ["read", "get", `/admin/blog/categories/${cat.id}`],
          ["update", "post", `/admin/blog/categories/${cat.id}`, { name: `N ${op}` }],
          ["delete", "delete", `/admin/blog/categories/${cat.id}`],
          ["read", "get", "/admin/blog/tags"],
          ["create", "post", "/admin/blog/tags", { name: "M", slug: `m-${op}` }],
          ["read", "get", `/admin/blog/tags/${tag.id}`],
          ["update", "post", `/admin/blog/tags/${tag.id}`, { name: `M ${op}` }],
          ["delete", "delete", `/admin/blog/tags/${tag.id}`],
        ]
        for (const [needs, method, url, body] of routes) {
          const status = (await call(method, url, headers, body)).status
          expect([op, method, url, status === 403]).toEqual([op, method, url, needs !== op])
        }
      }
    })

    it("a banned term blocks publishing (400 with the terms); drafts may hold them; nothing goes live", async () => {
      const editor = await asRole("content_editor")
      const draft = await createPost(editor, { title: "腸道筆記", slug: "notes", type: "pillar", body_markdown: "內文提到便秘。\n也提到免疫。" })
      expect(draft.status).toEqual("draft")
      const publish = await call("post", `/admin/blog/posts/${draft.id}`, editor, { status: "published" })
      expect(publish.status).toEqual(400)
      expect(publish.data).toMatchObject({ type: "invalid_data", code: "BLOG_BANNED_TERMS", terms: ["便秘", "免疫"] })
      expect(publish.data.hits).toEqual([
        { field: "body_markdown", term: "便秘", reason: expect.any(String), line: 1, column: 5 },
        { field: "body_markdown", term: "免疫", reason: expect.any(String), line: 2, column: 4 },
      ])
      expect((await call("get", `/admin/blog/posts/${draft.id}`, editor)).data.post).toMatchObject({ status: "draft", published_at: null })
      expect((await storeGet("/store/blog/posts/notes")).status).toEqual(404)
      // Every checked field blocks, also when creating as published; disclaimers do not.
      for (const field of ["title", "excerpt", "meta_title", "meta_description"]) {
        const r = await call("post", "/admin/blog/posts", editor, { title: "標題", slug: `x-${field.replace("_", "-")}`, type: "pillar", status: "published", [field]: "改善過敏體質" })
        expect([field, r.status, r.data.terms]).toEqual([field, 400, ["過敏"]])
      }
      const ok = await call("post", `/admin/blog/posts/${draft.id}`, editor, {
        status: "published",
        body_markdown: "幫助消化。本產品為一般食品，非藥品，不具醫療效能。",
      })
      expect(ok.status).toEqual(200)
      expect((await storeGet("/store/blog/posts/notes")).status).toEqual(200)
      // Once live, an edit that adds a banned term is refused as well.
      expect((await call("post", `/admin/blog/posts/${draft.id}`, editor, { excerpt: "治療" })).data.terms).toEqual(["治療"])
      // Category and tag names are public: same gate.
      expect((await call("post", "/admin/blog/categories", editor, { name: "便秘專區", slug: "c-bad" })).data.terms).toEqual(["便秘"])
      expect((await call("post", "/admin/blog/tags", editor, { name: "殺菌", slug: "t-bad" })).status).toEqual(400)
    })

    it("categories and tags: filters, replaceable sets, unique slugs, newest-first pagination", async () => {
      const editor = await asRole("content_editor")
      const mk = async (path: "categories" | "tags", name: string, slug: string) =>
        (await call("post", `/admin/blog/${path}`, editor, { name, slug })).data[path === "categories" ? "category" : "tag"]
      const [gut, food, sleep] = [await mk("categories", "腸道", "gut"), await mk("categories", "飲食", "food"), await mk("categories", "睡眠", "sleep")]
      const tagA = await mk("tags", "入門", "basics")
      const pillar = await createPost(editor, { title: "P", slug: "p", type: "pillar", status: "published", published_at: PAST(1), category_ids: [gut.id, food.id], tag_ids: [tagA.id] })
      for (let i = 2; i <= 5; i++) {
        await createPost(editor, { title: `C${i}`, slug: `c${i}`, type: "cluster", pillar_id: pillar.id, status: "published", published_at: PAST(i), category_ids: i % 2 ? [food.id] : [gut.id, food.id] })
      }
      const slugs = async (q: string) => (await storeGet(`/store/blog/posts${q}`)).data
      expect((await slugs("?category=gut")).posts.map((p: any) => p.slug)).toEqual(["c4", "c2", "p"])
      expect((await slugs("?category=food&limit=2&offset=1")).posts.map((p: any) => p.slug)).toEqual(["c4", "c3"])
      expect((await slugs("?category=food&limit=2&offset=1")).count).toEqual(5)
      expect((await slugs("?tag=basics")).posts.map((p: any) => p.slug)).toEqual(["p"])
      expect((await slugs("?category=gut&tag=basics&type=pillar")).posts.map((p: any) => p.slug)).toEqual(["p"])
      expect((await slugs("?category=nothing")).posts).toEqual([])
      expect((await slugs("?type=pillar")).posts.map((p: any) => p.slug)).toEqual(["p"])
      expect((await slugs("?limit=0")).message).toMatch(/limit/)
      // Each listed post carries all of its categories (not only the filtered one).
      const p = (await slugs("?tag=basics")).posts[0]
      expect(p.categories.map((c: any) => c.slug)).toEqual(["gut", "food"]) // 腸道 < 飲食 (code points)
      // Replace the set, then clear it.
      const set = async (ids: string[]) => (await call("post", `/admin/blog/posts/${pillar.id}`, editor, { category_ids: ids })).data.post.categories.map((c: any) => c.slug)
      expect(await set([food.id, sleep.id])).toEqual(["sleep", "food"])
      expect(await set([])).toEqual([])
      expect((await call("post", `/admin/blog/posts/${pillar.id}`, editor, { category_ids: ["bcat_missing"] })).data.message).toMatch(/unknown category/)
      // Store categories, by name.
      expect((await storeGet("/store/blog/categories")).data.categories.map((c: any) => c.slug)).toEqual(["sleep", "gut", "food"]) // 睡眠 < 腸道 < 飲食
      // Unique slugs (posts, categories, tags).
      expect((await call("post", "/admin/blog/posts", editor, { title: "dup", slug: "p", type: "pillar" })).data.message).toMatch(/already used/)
      expect((await call("post", "/admin/blog/categories", editor, { name: "x", slug: "gut" })).status).toEqual(400)
      expect((await call("post", `/admin/blog/tags/${tagA.id}`, editor, { slug: "basics" })).status).toEqual(200)
      // Deleting a category unlinks it from posts.
      await call("delete", `/admin/blog/categories/${food.id}`, editor)
      expect((await slugs("?category=gut")).posts.find((x: any) => x.slug === "c4").categories.map((c: any) => c.slug)).toEqual(["gut"])
    })

    it("the store routes need a publishable key", async () => {
      const r = await call("get", "/store/blog/posts", {})
      expect(r.status).toEqual(400)
      expect((await call("get", "/store/blog/categories", {})).status).toEqual(400)
    })

    it("drn-0008 gives a pre-P6 content_editor role the blog policies once (and its new description)", async () => {
      const rbac = getContainer().resolve<IRbacModuleService>(Modules.RBAC)
      const roleKeys = async () => {
        const [role] = await rbac.listRbacRoles({ name: "content_editor" }, { relations: ["policies"] })
        return { role, keys: (role.policies ?? []).map((p: any) => p.key as string) }
      }
      const { role, keys } = await roleKeys()
      expect(keys).toEqual(expect.arrayContaining(BLOG_POLICY_KEYS))
      // Rewind the role to its pre-P6 state.
      const links = await rbac.listRbacRolePolicies({ role_id: role.id }, { relations: ["policy"] })
      await rbac.deleteRbacRolePolicies(links.filter((l: any) => BLOG_POLICY_KEYS.includes(l.policy.key)).map((l: any) => l.id))
      await rbac.updateRbacRoles({ id: role.id, description: CONTENT_EDITOR_DESCRIPTION_BEFORE_P6 })
      const before = await roleKeys()
      expect(before.keys.filter((k) => k.startsWith("blog_"))).toEqual([])

      await drnBlogRbac({ container: getContainer() })
      const after = await roleKeys()
      expect(after.keys.filter((k) => k.startsWith("blog_")).sort()).toEqual([...BLOG_POLICY_KEYS].sort())
      expect(after.keys.length).toEqual(before.keys.length + BLOG_POLICY_KEYS.length)
      expect(after.role.description).toEqual(CONTENT_EDITOR_DESCRIPTION)
      await drnBlogRbac({ container: getContainer() })
      expect((await roleKeys()).keys.length).toEqual(after.keys.length)
      // Other roles never get blog policies.
      for (const name of ["operations", "support", "finance"]) {
        const [r] = await rbac.listRbacRoles({ name }, { relations: ["policies"] })
        expect([name, (r.policies ?? []).filter((p: any) => p.key.startsWith("blog_"))]).toEqual([name, []])
      }
    })
  },
})
