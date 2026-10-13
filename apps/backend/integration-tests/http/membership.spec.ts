// [P5-03] Tier engine acceptance (docs/strategy/membership.md §11): registered members buy
// through the Store API, ECPay notices capture the payment, staff ship and mark delivered;
// the engine runs with a chosen clock (evaluateAllMembers / recomputeCustomerTier) or through
// the refund subscriber in real time.
//
// What these tests cannot prove: the 03:00 cron itself (the job is a thin wrapper and is
// disabled under NODE_ENV=test), and the production gate on an unapproved config beyond the
// unit test of engineBlockedReason.
//
// Run: cd apps/backend && ../../infra/test-env.sh env TEST_TYPE=integration:http \
//   NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --forceExit integration-tests/http/membership.spec.ts
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { linkCustomerGroupsToCustomerWorkflow } from "@medusajs/medusa/core-flows"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import catalog from "../../src/data/catalog.json"
import { ECPAY_PROVIDER_ID } from "../../src/lib/ecpay/config"
import { loadTierConfig } from "../../src/lib/membership/config"
import { evaluateAllMembers, recomputeCustomerTier, tierGroupIds } from "../../src/lib/membership/engine"
import { taipeiDayOfMonth } from "../../src/lib/membership/rules"
import { addTestShipping, makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"

jest.setTimeout(240 * 1000)

const DAY = 24 * 3600 * 1000

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const h = makeCheckoutHelpers({ api, getContainer })

    beforeAll(async () => {
      const container = getContainer()
      await runAllSeeds(container)
      await addTestShipping(container)
      await devAddTestStock({ container, args: [] } as any)
    })

    const register = h.registerCustomer

    // A paid order of `bottles` bottles (ECPay notice captures it). headers: member or guest.
    const paidOrder = async (headers: Record<string, string>, bottles: number, email = "buyer@drn.test") => {
      const { data: r } = await api.get("/store/regions", { headers })
      const { data: p } = await api.get(`/store/products?handle=${catalog.products[0].handle}&fields=*variants`, { headers })
      const { data: c } = await api.post(
        "/store/carts",
        {
          region_id: r.regions[0].id,
          email,
          shipping_address: { first_name: "測試", last_name: "會員", address_1: "信義路五段7號", city: "台北市", postal_code: "110", country_code: "tw", phone: "0912345678" },
        },
        { headers }
      )
      const cartId = c.cart.id
      await api.post(`/store/carts/${cartId}/line-items`, { variant_id: p.products[0].variants[0].id, quantity: bottles }, { headers })
      const { data: so } = await api.get(`/store/shipping-options?cart_id=${cartId}`, { headers })
      await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: so.shipping_options.find((o: any) => o.name === "Test home delivery").id }, { headers })
      const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, { headers })
      const { data: ps } = await api.post(
        `/store/payment-collections/${pc.payment_collection.id}/payment-sessions`,
        { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } },
        { headers }
      )
      const session = ps.payment_collection.payment_sessions[0]
      const { data: done } = await api.post(`/store/carts/${cartId}/complete`, {}, { headers })
      expect(done.type).toEqual("order")
      expect((await h.postNotice(h.paidNotice(session.data, session))).data).toEqual("1|OK")
      expect(await h.capturedPayments(session.id)).toHaveLength(1)
      return { orderId: done.order.id as string, sessionId: session.id as string }
    }

    // Staff ship the whole order and mark it delivered; optionally backdate the delivery.
    // quantity: ship only that many units of each line (partial fulfillment)
    const deliver = async (orderId: string, deliveredAt?: Date, quantity?: number) => {
      const admin = await h.superAdminHeaders(`ship-${orderId}-${Math.random()}@drn.test`)
      const { data } = await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph({ entity: "order", fields: ["items.id", "items.quantity", "items.detail.quantity"], filters: { id: orderId } })
      const items = (data[0] as any).items.map((i: any) => ({ id: i.id, quantity: quantity ?? Number(i.quantity ?? i.detail?.quantity) }))
      const res = await api.post(`/admin/orders/${orderId}/fulfillments`, { items }, { headers: admin, validateStatus: () => true })
      expect({ status: res.status, message: res.data?.message }).toEqual({ status: 200, message: undefined })
      const { data: o } = await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph({ entity: "order", fields: ["fulfillments.id"], filters: { id: orderId } })
      const fid = (o[0] as any).fulfillments[0].id
      expect((await api.post(`/admin/orders/${orderId}/fulfillments/${fid}/mark-as-delivered`, {}, { headers: admin, validateStatus: () => true })).status).toEqual(200)
      if (deliveredAt) {
        await getContainer().resolve(Modules.FULFILLMENT).updateFulfillment(fid, { delivered_at: deliveredAt })
      }
      return fid
    }

    const membership = async (customerId: string) => {
      const { data } = await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph({ entity: "customer", fields: ["metadata", "groups.name"], filters: { id: customerId } })
      const c = data[0] as any
      return { meta: c.metadata?.drn_membership, log: c.metadata?.drn_membership_log ?? [], groups: (c.groups ?? []).map((g: any) => g.name).sort() }
    }

    const nextTaipeiFirst = (from: Date) => {
      let d = new Date(from.getTime() + DAY)
      while (taipeiDayOfMonth(d) !== 1) d = new Date(d.getTime() + DAY)
      return d
    }

    it("spend counts 10 days after delivery: member at day 9, 回購會員 at day 11; 9 bottles go straight to 長期會員", async () => {
      const m = await register("tier-up@drn.test")
      const { orderId } = await paidOrder(m.headers, 1)
      await deliver(orderId)
      const t0 = Date.now()
      const r9 = await recomputeCustomerTier(getContainer(), m.customerId, "daily", { now: new Date(t0 + 9 * DAY) })
      expect(r9).toMatchObject({ from: "member", to: "member", change: "none", confirmed: 0, pending: 1150 })
      expect((await membership(m.customerId)).groups).toEqual([])
      const r11 = await recomputeCustomerTier(getContainer(), m.customerId, "daily", { now: new Date(t0 + 11 * DAY) })
      expect(r11).toMatchObject({ from: "member", to: "repeat", change: "up", confirmed: 1150, pending: 0 })
      const after = await membership(m.customerId)
      expect(after.groups).toEqual(["tier-repeat"])
      expect(after.meta).toMatchObject({ tier: "repeat", tier_name: "回購會員", confirmed_spend_twd: 1150, config_version: loadTierConfig().config_version })
      expect(after.log).toEqual([expect.objectContaining({ from: "member", to: "repeat", reason: "daily" })])
      // Running again changes nothing and logs nothing.
      expect((await recomputeCustomerTier(getContainer(), m.customerId, "daily", { now: new Date(t0 + 12 * DAY) })).change).toEqual("none")
      expect((await membership(m.customerId)).log).toHaveLength(1)

      const big = await register("tier-loyal@drn.test")
      const o = await paidOrder(big.headers, 9)
      await deliver(o.orderId)
      expect(await recomputeCustomerTier(getContainer(), big.customerId, "daily", { now: new Date(t0 + 11 * DAY) })).toMatchObject({ to: "loyal", confirmed: 10350 })
      expect((await membership(big.customerId)).groups).toEqual(["tier-loyal"])
    })

    it("without a delivery record the order counts 30 days after payment", async () => {
      const m = await register("tier-nodelivery@drn.test")
      await paidOrder(m.headers, 1)
      const t0 = Date.now()
      expect(await recomputeCustomerTier(getContainer(), m.customerId, "daily", { now: new Date(t0 + 29 * DAY) })).toMatchObject({ to: "member", pending: 1150 })
      expect(await recomputeCustomerTier(getContainer(), m.customerId, "daily", { now: new Date(t0 + 31 * DAY) })).toMatchObject({ to: "repeat", confirmed: 1150 })
    })

    it("a refund that drops spend below the threshold downgrades at once (payment.refunded subscriber)", async () => {
      const m = await register("tier-refund@drn.test")
      const { orderId, sessionId } = await paidOrder(m.headers, 1)
      await deliver(orderId, new Date(Date.now() - 11 * DAY))
      expect(await recomputeCustomerTier(getContainer(), m.customerId, "daily")).toMatchObject({ to: "repeat", confirmed: 1150 })
      const [payment] = await h.capturedPayments(sessionId)
      const admin = await h.superAdminHeaders(`refund-${orderId}@drn.test`)
      expect((await api.post(`/admin/payments/${payment.id}/refund`, { amount: 575 }, { headers: admin, validateStatus: () => true })).status).toEqual(200)
      let state = await membership(m.customerId)
      for (let i = 0; i < 40 && state.meta?.tier !== "member"; i++) {
        await new Promise((r) => setTimeout(r, 250))
        state = await membership(m.customerId)
      }
      expect(state.meta).toMatchObject({ tier: "member", confirmed_spend_twd: 575 })
      expect(state.groups).toEqual([])
      expect(state.log.at(-1)).toMatchObject({ from: "repeat", to: "member", reason: "refund" })
    })

    it("when old orders leave the 12-month window the tier is kept until the monthly review day", async () => {
      const m = await register("tier-expiry@drn.test")
      const { orderId } = await paidOrder(m.headers, 1)
      await deliver(orderId, new Date(Date.now() - 11 * DAY))
      expect((await evaluateAllMembers(getContainer())).find((r) => r.customer_id === m.customerId)).toMatchObject({ to: "repeat" })
      let afterWindow = new Date(Date.now() + 366 * DAY)
      while (taipeiDayOfMonth(afterWindow) === 1) afterWindow = new Date(afterWindow.getTime() + DAY)
      const held = (await evaluateAllMembers(getContainer(), { now: afterWindow })).find((r) => r.customer_id === m.customerId)
      expect(held).toMatchObject({ from: "repeat", to: "repeat", change: "held", confirmed: 0 })
      expect((await membership(m.customerId)).meta).toMatchObject({ tier: "repeat", held_until_review: true })
      // An unrelated cancel or refund (spend unchanged) does not cut the hold short.
      expect(await recomputeCustomerTier(getContainer(), m.customerId, "cancel", { now: afterWindow })).toMatchObject({ to: "repeat", change: "held" })
      expect((await membership(m.customerId)).groups).toEqual(["tier-repeat"])
      const review = (await evaluateAllMembers(getContainer(), { now: nextTaipeiFirst(afterWindow) })).find((r) => r.customer_id === m.customerId)
      expect(review).toMatchObject({ from: "repeat", to: "member", change: "down" })
      expect((await membership(m.customerId)).groups).toEqual([])
    })

    it("a partly shipped order is not confirmed by the first delivery (unshipped units still in their cooling-off)", async () => {
      const m = await register("tier-partial@drn.test")
      const { orderId } = await paidOrder(m.headers, 9)
      await deliver(orderId, new Date(Date.now() - 12 * DAY), 1)
      expect(await recomputeCustomerTier(getContainer(), m.customerId, "daily")).toMatchObject({ to: "member", confirmed: 0, pending: 10350 })
      expect(await recomputeCustomerTier(getContainer(), m.customerId, "daily", { now: new Date(Date.now() + 31 * DAY) })).toMatchObject({ to: "loyal", confirmed: 10350 })
    })

    it("a renamed sales channel stops the engine instead of zeroing everyone's spend", async () => {
      const m = await register("tier-channel@drn.test")
      const sc = getContainer().resolve(Modules.SALES_CHANNEL)
      const [official] = await sc.listSalesChannels({ name: "Official Store" })
      await sc.updateSalesChannels(official.id, { name: "官網" })
      await expect(recomputeCustomerTier(getContainer(), m.customerId, "daily")).rejects.toThrow(/sales channel\(s\) "Official Store" missing/)
      await sc.updateSalesChannels(official.id, { name: "Official Store" })
    })

    it("shoppers cannot write the drn_ metadata that holds their tier and its log", async () => {
      const m = await register("tier-metadata@drn.test")
      const forged = await api.post("/store/customers/me", { metadata: { drn_membership_log: [], drn_membership: { tier: "loyal" } } }, { headers: m.headers, validateStatus: () => true })
      expect({ status: forged.status, message: forged.data.message }).toEqual({ status: 400, message: "metadata keys starting with drn_ are reserved" })
      expect((await api.post("/store/customers/me", { metadata: { newsletter_topic: "x" } }, { headers: m.headers, validateStatus: () => true })).status).toEqual(200)
    })

    it("a member found in both tier groups is put back into exactly one", async () => {
      const m = await register("tier-both@drn.test")
      const { orderId } = await paidOrder(m.headers, 1)
      await deliver(orderId, new Date(Date.now() - 11 * DAY))
      const groups = await tierGroupIds(getContainer(), loadTierConfig())
      await linkCustomerGroupsToCustomerWorkflow(getContainer()).run({ input: { id: m.customerId, add: [...groups.values()] } })
      expect((await membership(m.customerId)).groups).toEqual(["tier-loyal", "tier-repeat"])
      // Spend says 回購會員; on a refund/cancel recompute the extra higher group goes at once.
      expect(await recomputeCustomerTier(getContainer(), m.customerId, "cancel")).toMatchObject({ from: "loyal", to: "repeat", change: "down" })
      expect((await membership(m.customerId)).groups).toEqual(["tier-repeat"])
    })

    it("guest checkouts are not members and are never evaluated", async () => {
      const guest = await h.storeHeaders()
      const { orderId } = await paidOrder(guest, 9, "guest-tier@drn.test")
      await deliver(orderId, new Date(Date.now() - 11 * DAY))
      const { data } = await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph({ entity: "order", fields: ["customer_id"], filters: { id: orderId } })
      const guestId = (data[0] as any).customer_id
      expect(await recomputeCustomerTier(getContainer(), guestId, "daily")).toMatchObject({ change: "skipped" })
      expect((await evaluateAllMembers(getContainer())).some((r) => r.customer_id === guestId)).toBe(false)
      expect((await membership(guestId)).groups).toEqual([])
    })
  },
})
