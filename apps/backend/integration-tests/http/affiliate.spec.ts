// [P9-01] Affiliate stores (/s/<slug>) and order attribution, used through the Store API exactly
// as the group-buy storefront will, and managed through the admin API by an "operations" user.
//
// What these tests cannot prove: the storefront's 30-day first-party cookie (docs/strategy/
// affiliate.md §2 is the contract; P9-04 tests it), and the order.placed subscriber's timing under
// the production Redis event bus (here the in-memory bus runs it right after placement).
//
// Run: cd apps/backend && ../../infra/test-env.sh env TEST_TYPE=integration:http \
//   NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --forceExit integration-tests/http/affiliate.spec.ts
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules, generateJwtToken } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import catalog from "../../src/data/catalog.json"
import { ECPAY_PROVIDER_ID } from "../../src/lib/ecpay/config"
import { PUBLISHABLE_KEYS, SALES_CHANNELS } from "../../src/lib/drn-setup"
import { addTestShipping, makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"

jest.setTimeout(180 * 1000)

const HOUR = 3600 * 1000
const iso = (ms: number) => new Date(ms).toISOString()

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const { storeHeaders, superAdminHeaders } = makeCheckoutHelpers({ api, getContainer })

    beforeAll(async () => {
      const container = getContainer()
      await runAllSeeds(container)
      await addTestShipping(container)
      await devAddTestStock({ container, args: [] } as any)
      const [official] = await container.resolve(Modules.SALES_CHANNEL).listSalesChannels({ name: SALES_CHANNELS.official.name })
      const [profile] = await container.resolve(Modules.FULFILLMENT).listShippingProfiles({ type: "default" })
      await createProductsWorkflow(container).run({
        input: {
          products: [
            {
              title: "官網限定品",
              handle: "official-only",
              status: "published",
              shipping_profile_id: profile.id,
              options: [{ title: "規格", values: ["一包"] }],
              variants: [{ title: "一包", sku: "OFFICIAL-ONLY-01", options: { 規格: "一包" }, manage_inventory: false, prices: [{ currency_code: "twd", amount: 300 }] }],
              sales_channels: [{ id: official.id }],
            },
          ],
        },
      })
    })

    const groupBuyHeaders = async () => {
      const [key] = await getContainer().resolve(Modules.API_KEY).listApiKeys({ title: PUBLISHABLE_KEYS.groupBuy, type: "publishable" })
      return { "x-publishable-api-key": key.token }
    }
    const admins = new Map<string, Record<string, string>>()
    const admin = async (role = "operations") => {
      if (!admins.has(role)) admins.set(role, await superAdminHeaders(`aff-${role.replace(/\W/g, "")}@drn.test`, role))
      return admins.get(role)!
    }
    const noRoleHeaders = async () => {
      const container = getContainer()
      const email = "aff-norole@drn.test"
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
    const opts = (headers: Record<string, string>) => ({ headers, validateStatus: () => true })

    const product = async (handle: string) => {
      const { data } = await api.get(`/store/products?handle=${handle}&fields=id,*variants`, { headers: await groupBuyHeaders() })
      return { id: data.products[0].id as string, variantId: data.products[0].variants[0].id as string }
    }
    const bottle = () => product(catalog.products[0].handle)

    let seq = 0
    const newPartner = async (over: Record<string, unknown> = {}) => {
      seq++
      const r = await api.post("/admin/affiliate/partners", { display_name: `團主 ${seq}`, tuangou_kol_id: `kol-${seq}`, ...over }, opts(await admin()))
      expect(r.status).toEqual(201)
      return r.data.partner as { id: string; tuangou_kol_id: string }
    }
    const newStore = async (over: Record<string, unknown> = {}, partnerId?: string) => {
      const b = await bottle()
      const pid = partnerId ?? (await newPartner()).id
      seq++
      const body = {
        partner_id: pid,
        slug: `store-${seq}`,
        title: `測試賣場 ${seq}`,
        product_ids: [b.id],
        starts_at: iso(Date.now() - HOUR),
        ends_at: iso(Date.now() + 24 * HOUR),
        status: "active",
        ...over,
      }
      const r = await api.post("/admin/affiliate/stores", body, opts(await admin()))
      expect(r.status).toEqual(201)
      return r.data.store as { id: string; slug: string; partner_id: string }
    }

    const makeCart = async (headers: Record<string, string>, qty = 1) => {
      const b = await bottle()
      const { data: r } = await api.get("/store/regions", { headers })
      const { data: c } = await api.post(
        "/store/carts",
        {
          region_id: r.regions[0].id,
          email: "fan@drn.test",
          shipping_address: { first_name: "測試", last_name: "粉絲", address_1: "信義路五段7號", city: "台北市", postal_code: "110", country_code: "tw", phone: "0912345678" },
        },
        { headers }
      )
      const cartId = c.cart.id as string
      await api.post(`/store/carts/${cartId}/line-items`, { variant_id: b.variantId, quantity: qty }, { headers })
      const { data: so } = await api.get(`/store/shipping-options?cart_id=${cartId}`, { headers })
      const option = so.shipping_options.find((o: any) => o.name === "Test home delivery")
      await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: option.id }, { headers })
      return cartId
    }
    const attribute = async (cartId: string, slug: string, headers?: Record<string, string>) =>
      api.post(`/store/carts/${cartId}/affiliate`, { slug }, opts(headers ?? (await groupBuyHeaders())))
    const cartMeta = async (cartId: string) => {
      const { data } = await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph({ entity: "cart", fields: ["metadata"], filters: { id: cartId } })
      return (data[0]?.metadata ?? {}) as Record<string, any>
    }
    const complete = async (cartId: string, headers: Record<string, string>) => {
      const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, { headers })
      await api.post(`/store/payment-collections/${pc.payment_collection.id}/payment-sessions`, { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } }, { headers })
      const done = await api.post(`/store/carts/${cartId}/complete`, {}, opts(headers))
      expect({ status: done.status, type: done.data.type }).toEqual({ status: 200, type: "order" })
      return done.data.order.id as string
    }
    const orderMeta = async (orderId: string) =>
      ((await getContainer().resolve(Modules.ORDER).retrieveOrder(orderId, { select: ["metadata"] })).metadata ?? {}) as Record<string, any>
    // The order.placed subscriber settles the attribution right after placement.
    const settledMeta = async (orderId: string) => {
      for (let i = 0; i < 100; i++) {
        const m = await orderMeta(orderId)
        if (m.affiliate?.verified_at || m.affiliate_dropped) return m
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error(`attribution of ${orderId} was never settled`)
    }

    describe("admin API and RBAC", () => {
      it("operations manages partners and stores; finance only reads; support, no role and no login are refused", async () => {
        const partner = await newPartner({ ig_handle: "@amy.tw" })
        expect(partner).toMatchObject({ tuangou_kol_id: expect.any(String), ig_handle: "amy.tw", status: "active" })
        const store = await newStore({}, partner.id)
        const ops = await admin("operations")
        expect((await api.get("/admin/affiliate/partners", opts(ops))).data.partners.some((p: any) => p.id === partner.id)).toBe(true)
        expect((await api.get(`/admin/affiliate/stores/${store.id}`, opts(ops))).data.store).toMatchObject({ slug: store.slug, partner: { id: partner.id } })
        expect((await api.post(`/admin/affiliate/stores/${store.id}`, { title: "改名" }, opts(ops))).data.store.title).toEqual("改名")

        const finance = await admin("finance")
        expect((await api.get("/admin/affiliate/stores", opts(finance))).status).toEqual(200)
        expect((await api.post("/admin/affiliate/partners", { display_name: "x" }, opts(finance))).status).toEqual(403)
        expect((await api.post(`/admin/affiliate/stores/${store.id}`, { title: "x" }, opts(finance))).status).toEqual(403)

        const support = await admin("support")
        expect((await api.get("/admin/affiliate/partners", opts(support))).status).toEqual(403)
        expect((await api.get(`/admin/affiliate/partners/${partner.id}`, opts(support))).status).toEqual(403)
        expect((await api.post("/admin/affiliate/stores", {}, opts(support))).status).toEqual(403)
        expect((await api.delete(`/admin/affiliate/stores/${store.id}`, opts(support))).status).toEqual(403)
        expect((await api.get("/admin/affiliate/stores", opts(await admin("content_editor")))).status).toEqual(403)
        expect((await api.get("/admin/affiliate/stores", opts(await noRoleHeaders()))).status).toEqual(403)
        expect((await api.get("/admin/affiliate/stores", opts({}))).status).toEqual(401)
      })

      it("refuses bad input: slug format, taken slug or KOL id, inverted window, products outside the group-buy channel", async () => {
        const ops = await admin()
        const store = await newStore()
        const b = await bottle()
        const officialOnly = (await api.get("/store/products?handle=official-only&fields=id", { headers: await storeHeaders() })).data.products[0].id
        const base = { partner_id: store.partner_id, title: "t", product_ids: [b.id], starts_at: iso(Date.now()), ends_at: iso(Date.now() + HOUR) }
        const create = (over: Record<string, unknown>) => api.post("/admin/affiliate/stores", { ...base, slug: `ok-${++seq}`, ...over }, opts(ops))
        expect((await create({ slug: "Bad_Slug" })).status).toEqual(400)
        expect((await create({ slug: store.slug.toUpperCase() })).data.message).toMatch(/already used/)
        expect((await create({ starts_at: base.ends_at, ends_at: base.starts_at })).status).toEqual(400)
        expect((await create({ product_ids: ["prod_missing"] })).data.message).toMatch(/prod_missing/)
        expect((await create({ product_ids: [officialOnly] })).data.message).toMatch(/group-buy/)
        expect((await create({ partner_id: "apart_missing" })).status).toEqual(400)
        const p = await newPartner()
        expect((await api.post("/admin/affiliate/partners", { display_name: "dup", tuangou_kol_id: p.tuangou_kol_id }, opts(ops))).data.message).toMatch(/already used/)
        expect((await api.post(`/admin/affiliate/partners/${p.id}`, { tuangou_kol_id: (await newPartner()).tuangou_kol_id }, opts(ops))).status).toEqual(400)
        expect((await api.post(`/admin/affiliate/stores/${store.id}`, { ends_at: iso(Date.now() - 2 * HOUR) }, opts(ops))).status).toEqual(400)
      })

      it("keeps history: no slug change or delete once a store was open, no partner delete while it has stores", async () => {
        const ops = await admin()
        const store = await newStore()
        expect((await api.post(`/admin/affiliate/stores/${store.id}`, { slug: "renamed-open" }, opts(ops))).status).toEqual(400)
        expect((await api.delete(`/admin/affiliate/stores/${store.id}`, opts(ops))).status).toEqual(400)
        expect((await api.delete(`/admin/affiliate/partners/${store.partner_id}`, opts(ops))).status).toEqual(400)
        const draft = await newStore({ status: "draft" })
        const renamed = await api.post(`/admin/affiliate/stores/${draft.id}`, { slug: `Draft-Renamed-${seq}` }, opts(ops))
        expect(renamed.data.store.slug).toEqual(`draft-renamed-${seq}`)
        expect((await api.delete(`/admin/affiliate/stores/${draft.id}`, opts(ops))).data).toMatchObject({ id: draft.id, deleted: true })
        expect((await api.delete(`/admin/affiliate/partners/${draft.partner_id}`, opts(ops))).data).toMatchObject({ deleted: true })
      })
    })

    describe("store page", () => {
      it("an open store shows its partner's name and its products, on the group-buy storefront only", async () => {
        const store = await newStore()
        const b = await bottle()
        const r = await api.get(`/store/affiliate/stores/${store.slug.toUpperCase()}`, opts(await groupBuyHeaders()))
        expect(r.status).toEqual(200)
        expect(r.data.store).toMatchObject({ slug: store.slug, partner: { display_name: expect.stringMatching(/^團主/) } })
        expect(r.data.store.products.map((p: any) => p.id)).toEqual([b.id])
        expect(r.data.store.partner.id).toBeUndefined()
        expect((await api.get(`/store/affiliate/stores/${store.slug}`, opts(await storeHeaders()))).status).toEqual(404)
      })

      it("unknown, draft, ended, not yet started, expired stores and inactive partners answer 404", async () => {
        const gb = await groupBuyHeaders()
        const ops = await admin()
        const partner = await newPartner()
        const slugs = [
          "no-such-store",
          (await newStore({ status: "draft" })).slug,
          (await newStore({ status: "ended" })).slug,
          (await newStore({ starts_at: iso(Date.now() + HOUR), ends_at: iso(Date.now() + 2 * HOUR) })).slug,
          (await newStore({ starts_at: iso(Date.now() - 2 * HOUR), ends_at: iso(Date.now() - HOUR) })).slug,
          (await newStore({}, partner.id)).slug,
        ]
        await api.post(`/admin/affiliate/partners/${partner.id}`, { status: "inactive" }, opts(ops))
        for (const slug of slugs) {
          const r = await api.get(`/store/affiliate/stores/${slug}`, opts(gb))
          expect({ slug, status: r.status, message: r.data.message }).toEqual({ slug, status: 404, message: "找不到這個賣場，或賣場活動已結束。" })
        }
      })
    })

    describe("attribution", () => {
      it("an order placed through store S carries partner P in its metadata, verified at placement", async () => {
        const gb = await groupBuyHeaders()
        const store = await newStore()
        const cartId = await makeCart(gb)
        const r = await attribute(cartId, store.slug)
        expect(r.status).toEqual(200)
        expect(r.data.affiliate).toMatchObject({ store_id: store.id, partner_id: store.partner_id, slug: store.slug })
        const orderId = await complete(cartId, gb)
        expect((await orderMeta(orderId)).affiliate).toMatchObject({ store_id: store.id, partner_id: store.partner_id })
        const settled = await settledMeta(orderId)
        expect(settled.affiliate).toMatchObject({ store_id: store.id, partner_id: store.partner_id, slug: store.slug, verified_at: expect.any(String) })
        expect(settled.affiliate_dropped).toBeUndefined()

        const plain = await complete(await makeCart(gb), gb)
        expect((await orderMeta(plain)).affiliate).toBeUndefined()
      })

      it("the last store wins; DELETE removes the attribution", async () => {
        const gb = await groupBuyHeaders()
        const [s1, s2] = [await newStore(), await newStore()]
        const cartId = await makeCart(gb)
        await attribute(cartId, s1.slug)
        await attribute(cartId, s2.slug)
        expect((await cartMeta(cartId)).affiliate).toMatchObject({ store_id: s2.id })
        const del = await api.delete(`/store/carts/${cartId}/affiliate`, opts(gb))
        expect(del.status).toEqual(200)
        expect((await cartMeta(cartId)).affiliate).toBeUndefined()
      })

      it("unknown, inactive and expired slugs are refused; official-store carts and keys cannot be attributed", async () => {
        const gb = await groupBuyHeaders()
        const cartId = await makeCart(gb)
        const refused = [
          "no-such-store",
          (await newStore({ status: "ended" })).slug,
          (await newStore({ status: "draft" })).slug,
          (await newStore({ starts_at: iso(Date.now() - 2 * HOUR), ends_at: iso(Date.now() - HOUR) })).slug,
        ]
        for (const slug of refused) {
          const r = await attribute(cartId, slug)
          expect({ slug, status: r.status }).toEqual({ slug, status: 404 })
        }
        expect((await cartMeta(cartId)).affiliate).toBeUndefined()
        const open = await newStore()
        const official = await storeHeaders()
        expect((await attribute(await makeCart(official), open.slug, official)).status).toEqual(400)
        expect((await attribute(cartId, open.slug, official)).status).toEqual(400)
        expect((await api.post(`/store/carts/${cartId}/affiliate`, { slug: open.slug, store_id: "x" }, opts(gb))).status).toEqual(400)
      })

      it("cannot be forged or erased through the generic cart routes", async () => {
        const gb = await groupBuyHeaders()
        const store = await newStore()
        const forged = { store_id: store.id, partner_id: store.partner_id, slug: store.slug, attributed_at: iso(Date.now()) }
        const { data: r } = await api.get("/store/regions", { headers: gb })
        const created = await api.post("/store/carts", { region_id: r.regions[0].id, metadata: { affiliate: forged } }, opts(gb))
        expect(created.status).toEqual(400)

        const cartId = await makeCart(gb)
        const update = (metadata: unknown) => api.post(`/store/carts/${cartId}`, { metadata }, opts(gb))
        expect((await update({ affiliate: forged })).status).toEqual(400)
        expect((await update({ affiliate_dropped: { reason: "x" } })).status).toEqual(400)
        expect((await cartMeta(cartId)).affiliate).toBeUndefined()

        expect((await attribute(cartId, store.slug)).status).toEqual(200)
        expect((await update({ affiliate: "" })).status).toEqual(400)
        expect((await update({})).status).toEqual(400)
        expect((await update(null)).status).toEqual(400)
        expect((await update({ gift_note: "生日快樂" })).status).toEqual(200)
        expect(await cartMeta(cartId)).toMatchObject({ gift_note: "生日快樂", affiliate: { store_id: store.id } })
      })

      it("a store closed before the cart completes: the order is placed and the attribution dropped", async () => {
        const gb = await groupBuyHeaders()
        const ops = await admin()
        const ended = await newStore()
        const expired = await newStore()
        const cart1 = await makeCart(gb)
        const cart2 = await makeCart(gb)
        await attribute(cart1, ended.slug)
        await attribute(cart2, expired.slug)
        await api.post(`/admin/affiliate/stores/${ended.id}`, { status: "ended" }, opts(ops))
        await api.post(`/admin/affiliate/stores/${expired.id}`, { ends_at: iso(Date.now() - 1000) }, opts(ops))

        const o1 = await settledMeta(await complete(cart1, gb))
        expect(o1.affiliate).toBeUndefined()
        expect(o1.affiliate_dropped).toMatchObject({ store_id: ended.id, partner_id: ended.partner_id, reason: "ended", dropped_at: expect.any(String) })
        const o2 = await settledMeta(await complete(cart2, gb))
        expect(o2.affiliate).toBeUndefined()
        expect(o2.affiliate_dropped).toMatchObject({ store_id: expired.id, reason: "expired" })
      })
    })
  },
})
