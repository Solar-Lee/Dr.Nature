// P4-09 acceptance: unpaid ECPay orders are canceled after their deadline (stock released),
// but only after ECPay confirms they are unpaid; and an unpaid order can be re-paid with a
// new ECPay trade by its owner. ECPay QueryTradeInfo is a local stub (signed like real stage).
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import { cancelUnpaidOrders } from "../../src/jobs/ecpay-unpaid-cancel"
import { resetTradeQueryPause } from "../../src/lib/ecpay/trade-query"
import { MAC, MERCHANT_ID, addTestShipping, makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"
import { makeTradeStub } from "../helpers/ecpay-trade-stub"

jest.setTimeout(180 * 1000)

const STUB_URL = new URL(process.env.ECPAY_API_BASE_URL as string)
const stub = makeTradeStub(MERCHANT_ID, MAC)
const MIN = 60 * 1000

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    beforeAll(async () => {
      await new Promise<void>((resolve) => stub.server.listen(Number(STUB_URL.port), STUB_URL.hostname, resolve))
      const container = getContainer()
      await runAllSeeds(container)
      await addTestShipping(container)
      await devAddTestStock({ container, args: [] } as any)
    })
    afterAll(async () => {
      await new Promise<void>((resolve) => stub.server.close(() => resolve()))
    })
    beforeEach(() => {
      stub.reset()
      resetTradeQueryPause()
    })

    const h = makeCheckoutHelpers({ api, getContainer })
    const orderOf = async (cartId: string) => {
      const { data } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "cart", fields: ["order.id", "order.status", "order.created_at", "order.metadata", "order.items.id"], filters: { id: cartId } })
      return (data[0] as any)?.order
    }
    const reservations = async (order: any) =>
      getContainer().resolve(Modules.INVENTORY).listReservationItems({ line_item_id: order.items.map((i: any) => i.id) })
    const after = (order: any, minutes: number) => new Date(new Date(order.created_at).getTime() + minutes * MIN)
    const run = (now: Date) => cancelUnpaidOrders(getContainer(), { now, gapMs: 0 })
    const sessionsOf = async (pcId: string) =>
      getContainer().resolve(Modules.PAYMENT).listPaymentSessions({ payment_collection_id: pcId })

    it("an unpaid credit order is canceled after 180 minutes (not before) and its stock released", async () => {
      const c = await h.checkout()
      const order = await orderOf(c.cartId)
      expect(await reservations(order)).not.toHaveLength(0)
      expect(await run(after(order, 179))).toEqual({})
      const out = await run(after(order, 181))
      expect(out[order.id]).toEqual("canceled")
      const now = await orderOf(c.cartId)
      expect(now.status).toEqual("canceled")
      expect(now.metadata.ecpay_auto_canceled).toMatchObject({ merchant_trade_no: c.sessionData.merchant_trade_no })
      expect(await reservations(order)).toHaveLength(0)
    })

    it("paid at ECPay but the notice was lost: recorded, never canceled", async () => {
      const c = await h.checkout()
      const order = await orderOf(c.cartId)
      stub.trades.set(c.sessionData.merchant_trade_no, { status: "1", amount: c.sessionData.amount })
      expect((await run(after(order, 181)))[order.id]).toEqual("paid:captured")
      expect((await orderOf(c.cartId)).status).toEqual("pending")
      expect(await h.capturedPayments(c.session.id)).toHaveLength(1)
    })

    it("ECPay unreachable: kept (fail closed)", async () => {
      const c = await h.checkout()
      const order = await orderOf(c.cartId)
      stub.state.mode = "down"
      expect((await run(after(order, 181)))[order.id]).toEqual("kept:ecpay_unreachable")
      expect((await orderOf(c.cartId)).status).toEqual("pending")
    })

    it("an issued ATM code is honoured until its deadline + 1 day", async () => {
      const c = await h.checkout({ choosePayment: "ATM" })
      const order = await orderOf(c.cartId)
      const info = await h.postPaymentInfo(h.codeIssuedNotice(c.sessionData, c.session, "ATM", { ExpireDate: "2026/10/16" }))
      expect(info.data).toEqual("1|OK")
      expect(await run(new Date("2026-10-17T12:00:00+08:00"))).toEqual({}) // deadline 10/16 23:59:59 + 1 day
      expect((await run(new Date("2026-10-18T00:30:00+08:00")))[order.id]).toEqual("canceled")
    })

    it("a paid order is never touched", async () => {
      const c = await h.checkout()
      const order = await orderOf(c.cartId)
      expect((await h.postNotice(h.paidNotice(c.sessionData, c.session))).data).toEqual("1|OK")
      expect(await run(after(order, 10_000))).toEqual({})
      expect(stub.asked).toHaveLength(0)
    })

    describe("re-pay", () => {
      const repay = async (orderId: string, body: Record<string, unknown>) =>
        api.post(`/store/orders/${orderId}/ecpay/repay`, body, { headers: await h.storeHeaders(), validateStatus: () => true })

      it("only with the order's e-mail; gives a NEW trade and replaces the old session", async () => {
        const c = await h.checkout()
        const order = await orderOf(c.cartId)
        expect((await repay(order.id, { email: "someone@else.test" })).status).toEqual(404)
        expect((await repay(order.id, {})).status).toEqual(404)
        const res = await repay(order.id, { email: "BUYER@drn.test", choose_payment: "Credit" })
        expect(res.status).toEqual(200)
        const fresh = res.data.payment_session
        expect(fresh.data.merchant_trade_no).toMatch(/^DN/)
        expect(fresh.data.merchant_trade_no).not.toEqual(c.sessionData.merchant_trade_no)
        expect(fresh.data.checkout_form.fields.MerchantTradeNo).toEqual(fresh.data.merchant_trade_no)
        const sessions = await sessionsOf(c.paymentCollectionId)
        expect(sessions.map((s: any) => s.id)).toEqual([fresh.id])
        // Paying the new trade completes the order's payment.
        expect((await h.postNotice(h.paidNotice(fresh.data, fresh))).data).toEqual("1|OK")
        expect(await h.capturedPayments(fresh.id)).toHaveLength(1)
      })

      it("if the old trade was in fact paid, it is recorded instead of opening a new one", async () => {
        const c = await h.checkout()
        const order = await orderOf(c.cartId)
        stub.trades.set(c.sessionData.merchant_trade_no, { status: "1", amount: c.sessionData.amount })
        const res = await repay(order.id, { email: "buyer@drn.test" })
        expect({ status: res.status, body: res.data }).toEqual({ status: 200, body: { already_paid: true } })
        expect(await h.capturedPayments(c.session.id)).toHaveLength(1)
      })

      it("ECPay unreachable: 503 and nothing changed (fail closed)", async () => {
        const c = await h.checkout()
        const order = await orderOf(c.cartId)
        stub.state.mode = "down"
        expect((await repay(order.id, { email: "buyer@drn.test" })).status).toEqual(503)
        expect((await sessionsOf(c.paymentCollectionId)).map((s: any) => s.id)).toEqual([c.session.id])
      })

      it("refused for a canceled order and while an ATM code can still be paid", async () => {
        const atm = await h.checkout({ choosePayment: "ATM" })
        const farFuture = new Date(Date.now() + 5 * 24 * 3600 * 1000)
        const expire = `${farFuture.getFullYear()}/${String(farFuture.getMonth() + 1).padStart(2, "0")}/${String(farFuture.getDate()).padStart(2, "0")}`
        expect((await h.postPaymentInfo(h.codeIssuedNotice(atm.sessionData, atm.session, "ATM", { ExpireDate: expire }))).data).toEqual("1|OK")
        const atmOrder = await orderOf(atm.cartId)
        const live = await repay(atmOrder.id, { email: "buyer@drn.test" })
        expect(live.status).toEqual(409)
        expect(live.data.payment_instructions).toMatchObject({ v_account: expect.any(String) })

        const c = await h.checkout()
        const order = await orderOf(c.cartId)
        const admin = await h.superAdminHeaders(`rp-${order.id}@drn.test`)
        await api.post(`/admin/orders/${order.id}/cancel`, {}, { headers: admin })
        expect((await repay(order.id, { email: "buyer@drn.test" })).status).toEqual(400)
      })
    })
  },
})
