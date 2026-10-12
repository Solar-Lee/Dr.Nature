// P4-10 acceptance: a credit payment whose ReturnURL notice never arrived is recovered by the
// reconcile job through QueryTradeInfo (local stub on ECPAY_API_BASE_URL, signed like real
// stage), on ECPay's documented schedule, without polling offline methods, and stopping on
// a 403. Not provable here: real ECPay timing of bank results.
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import { reconcileEcpayPayments, resetReconcileMemory } from "../../src/jobs/ecpay-payment-reconcile"
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
      resetReconcileMemory()
      resetTradeQueryPause()
    })

    const h = makeCheckoutHelpers({ api, getContainer })
    const at = (session: any, minutes: number) => new Date(new Date(session.created_at).getTime() + minutes * MIN)
    const sessionRow = async (id: string) =>
      (await getContainer().resolve(Modules.PAYMENT).listPaymentSessions({ id: [id] }))[0] as any
    const orderForCart = async (cartId: string) => {
      const { data } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "cart", fields: ["order.id", "order.status", "order.metadata"], filters: { id: cartId } })
      return (data[0] as any)?.order
    }
    const run = (now: Date) => reconcileEcpayPayments(getContainer(), { now, gapMs: 0 })

    it("lost ReturnURL: paid at ECPay -> recorded at 40 min, never asked again", async () => {
      const c = await h.checkout()
      const s = await sessionRow(c.session.id)
      stub.trades.set(c.sessionData.merchant_trade_no, { status: "1", amount: c.sessionData.amount })
      expect(await run(at(s, 39))).toEqual({}) // too early
      expect(stub.asked).toHaveLength(0)
      expect(await run(at(s, 41))).toEqual({ [s.id]: "captured" })
      expect(await h.capturedPayments(c.session.id)).toHaveLength(1)
      expect((await sessionRow(c.session.id)).data.ecpay_trade_info).toMatchObject({ TradeStatus: "1" })
      await run(at(s, 125))
      expect(stub.asked).toHaveLength(1)
    })

    it("cart never completed (notice lost before checkout finished): payment recorded and the order created", async () => {
      const c = await h.checkout({ complete: false })
      const s = await sessionRow(c.session.id)
      stub.trades.set(c.sessionData.merchant_trade_no, { status: "1", amount: c.sessionData.amount })
      expect(await run(at(s, 41))).toEqual({ [s.id]: "captured" })
      expect((await orderForCart(c.cartId))?.status).toEqual("pending")
    })

    it("unpaid: asked at 40 min, 2 h and 24 h only, never after 48 h", async () => {
      const c = await h.checkout()
      const s = await sessionRow(c.session.id)
      for (const m of [41, 60, 121, 600, 24 * 60 + 1, 47 * 60, 49 * 60]) await run(at(s, m))
      expect(stub.asked).toHaveLength(3)
      expect(await h.capturedPayments(c.session.id)).toHaveLength(0)
    })

    it("offline methods (ATM) are never polled", async () => {
      const c = await h.checkout({ choosePayment: "ATM" })
      const s = await sessionRow(c.session.id)
      await run(at(s, 41))
      await run(at(s, 24 * 60 + 1))
      expect(stub.asked).toHaveLength(0)
    })

    it("an amount mismatch is never captured", async () => {
      const c = await h.checkout()
      const s = await sessionRow(c.session.id)
      stub.trades.set(c.sessionData.merchant_trade_no, { status: "1", amount: 1 })
      expect(await run(at(s, 41))).toEqual({ [s.id]: "amount_mismatch" })
      expect(await h.capturedPayments(c.session.id)).toHaveLength(0)
    })

    it("ECPay unreachable is an error, not 'unpaid', and the point is retried later", async () => {
      const c = await h.checkout()
      const s = await sessionRow(c.session.id)
      stub.state.mode = "down"
      expect(await run(at(s, 41))).toEqual({ [s.id]: "error" })
      expect(await h.capturedPayments(c.session.id)).toHaveLength(0)
      stub.state.mode = "ok"
      stub.trades.set(c.sessionData.merchant_trade_no, { status: "1", amount: c.sessionData.amount })
      expect(await run(at(s, 51))).toEqual({ [s.id]: "captured" }) // next run, same point
    })

    it("a 403 stops the run and pauses every query for 30 minutes", async () => {
      const a = await h.checkout()
      const b = await h.checkout()
      const sa = await sessionRow(a.session.id)
      stub.state.mode = "403"
      const first = await run(at(sa, 45))
      expect(Object.values(first)).toEqual(["error"]) // stopped after the first 403
      expect(stub.asked).toHaveLength(1)
      stub.state.mode = "ok"
      stub.trades.set(b.sessionData.merchant_trade_no, { status: "1", amount: b.sessionData.amount })
      await run(at(sa, 50)) // still inside the 30-minute pause (wall clock)
      expect(stub.asked).toHaveLength(1)
    })

    it("paid after the order was canceled: flagged for a manual refund, never captured", async () => {
      const c = await h.checkout()
      const s = await sessionRow(c.session.id)
      const order = await orderForCart(c.cartId)
      const admin = await h.superAdminHeaders(`rc-${order.id}@drn.test`)
      expect((await api.post(`/admin/orders/${order.id}/cancel`, {}, { headers: admin, validateStatus: () => true })).status).toEqual(200)
      stub.trades.set(c.sessionData.merchant_trade_no, { status: "1", amount: c.sessionData.amount })
      expect(await run(at(s, 41))).toEqual({ [s.id]: "paid_after_cancel" })
      expect(await h.capturedPayments(c.session.id)).toHaveLength(0)
      expect((await orderForCart(c.cartId)).metadata.ecpay_paid_after_cancel).toMatchObject({ merchant_trade_no: c.sessionData.merchant_trade_no })
    })
  },
})
