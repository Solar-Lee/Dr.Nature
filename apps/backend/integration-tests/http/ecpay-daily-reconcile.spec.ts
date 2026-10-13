// P4-07 acceptance: the daily TradeNoAio reconciliation (local stub serving the CSV layout real
// stage returned) matches paid trades with Medusa, recovers paid-but-missing ones through a
// signed QueryTradeInfo + the shared recorder, ignores other merchants' rows, and alerts on
// every discrepancy. Not provable here: the production IP whitelist and real file timing.
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import { reconcileEcpayDay, taipeiDay } from "../../src/jobs/ecpay-daily-reconcile"
import { repayOrder } from "../../src/lib/ecpay/repay"
import { resetTradeQueryPause } from "../../src/lib/ecpay/trade-query"
import { MAC, MERCHANT_ID, addTestShipping, makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"
import { makeTradeStub } from "../helpers/ecpay-trade-stub"

jest.setTimeout(180 * 1000)

const STUB_URL = new URL(process.env.ECPAY_API_BASE_URL as string)
const stub = makeTradeStub(MERCHANT_ID, MAC)

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
    const today = () => taipeiDay(new Date())
    const run = () => reconcileEcpayDay(getContainer(), today())

    it("downloads ONE paid-by-payment-date file for the day, signed, UTF-8", async () => {
      await run()
      expect(stub.fileRequests).toHaveLength(1)
      expect(stub.fileRequests[0]).toMatchObject({ DateType: "2", BeginDate: today(), EndDate: today(), PaymentStatus: "1", CharSet: "2", MediaFormated: "0" })
    })

    it("a captured order listed as paid is ok; other merchants' rows are ignored", async () => {
      const c = await h.checkout()
      expect((await h.postNotice(h.paidNotice(c.sessionData, c.session))).data).toEqual("1|OK")
      stub.state.fileRows = [
        { merchantTradeNo: c.sessionData.merchant_trade_no, amount: c.sessionData.amount },
        { merchantTradeNo: "N6bf35797c9af24659bc", amount: 1200 }, // another developer on the public sandbox
      ]
      const r = await run()
      expect(r).toMatchObject({ file: "ok", paid_at_ecpay: 1, ok: 1, recovered: [], alerts: [] })
    })

    it("an ATM payment whose notice was lost is confirmed and recorded", async () => {
      const c = await h.checkout({ choosePayment: "ATM" })
      stub.state.fileRows = [{ merchantTradeNo: c.sessionData.merchant_trade_no, amount: c.sessionData.amount, method: "ATM" }]
      stub.trades.set(c.sessionData.merchant_trade_no, { status: "1", amount: c.sessionData.amount, paymentType: "ATM_LAND" })
      const r = await run()
      expect(r.recovered).toEqual([c.sessionData.merchant_trade_no])
      expect(await h.capturedPayments(c.session.id)).toHaveLength(1)
    })

    it("paid in the file but QueryTradeInfo does not confirm: alert, nothing recorded", async () => {
      const c = await h.checkout({ choosePayment: "ATM" })
      stub.state.fileRows = [{ merchantTradeNo: c.sessionData.merchant_trade_no, amount: c.sessionData.amount, method: "ATM" }]
      stub.trades.set(c.sessionData.merchant_trade_no, { status: "0", amount: c.sessionData.amount })
      const r = await run()
      expect(r.recovered).toEqual([])
      expect(r.alerts.join()).toContain("not confirmed")
      expect(await h.capturedPayments(c.session.id)).toHaveLength(0)
    })

    it("a paid trade of ours with no payment session, and an amount mismatch, both alert", async () => {
      const c = await h.checkout()
      stub.state.fileRows = [
        { merchantTradeNo: "DN2610130000000ZZZZZ", amount: 1150 },
        { merchantTradeNo: c.sessionData.merchant_trade_no, amount: c.sessionData.amount + 1 },
      ]
      const r = await run()
      expect(r.alerts).toHaveLength(2)
      expect(r.alerts.join("|")).toMatch(/no payment session.*\|.*expects/)
      expect(await h.capturedPayments(c.session.id)).toHaveLength(0)
    })

    const ecpayDate = (day: string, time = "10:00:00") => `${day.replace(/-/g, "/")} ${time}`

    it("captured in Medusa today but not paid in ECPay's file: alert", async () => {
      const c = await h.checkout()
      expect((await h.postNotice(h.paidNotice(c.sessionData, c.session, { PaymentDate: ecpayDate(today()) }))).data).toEqual("1|OK")
      const r = await run()
      expect(r.alerts.join()).toContain(`${c.sessionData.merchant_trade_no} is captured in Medusa but ECPay does not list it`)
    })

    it("paid yesterday at ECPay but recorded today (late notice / recovery): today's run does not alert", async () => {
      const c = await h.checkout()
      const yesterday = taipeiDay(new Date(Date.now() - 24 * 3600_000))
      expect((await h.postNotice(h.paidNotice(c.sessionData, c.session, { PaymentDate: ecpayDate(yesterday, "23:50:00") }))).data).toEqual("1|OK")
      const r = await run()
      expect(r.alerts.join()).not.toContain(c.sessionData.merchant_trade_no)
    })

    it("paid in the file for an order canceled meanwhile: alerted (paid_after_cancel), not counted as recovered", async () => {
      const c = await h.checkout({ choosePayment: "ATM" })
      const admin = await h.superAdminHeaders(`dr-${c.completion.order.id}@drn.test`)
      expect((await api.post(`/admin/orders/${c.completion.order.id}/cancel`, {}, { headers: admin, validateStatus: () => true })).status).toEqual(200)
      stub.state.fileRows = [{ merchantTradeNo: c.sessionData.merchant_trade_no, amount: c.sessionData.amount, method: "ATM" }]
      stub.trades.set(c.sessionData.merchant_trade_no, { status: "1", amount: c.sessionData.amount, paymentType: "ATM_LAND" })
      const r = await run()
      expect(r.recovered).toEqual([])
      expect(r.alerts.join()).toContain(`${c.sessionData.merchant_trade_no}`)
      expect(r.alerts.join()).toContain("paid_after_cancel")
      expect(await h.capturedPayments(c.session.id)).toHaveLength(0)
    })

    it("paid in the file on a second trade of an already paid (re-paid) order: alerted (paid_twice), not recovered", async () => {
      const c = await h.checkout()
      const s2 = ((await repayOrder(getContainer(), { orderId: c.completion.order.id, email: "buyer@drn.test" }, { now: new Date(Date.now() + 41 * 60_000) })).body as any).payment_session
      expect((await h.postNotice(h.paidNotice(c.sessionData, c.session, { PaymentDate: ecpayDate(today()) }))).data).toEqual("1|OK")
      stub.state.fileRows = [
        { merchantTradeNo: c.sessionData.merchant_trade_no, amount: c.sessionData.amount },
        { merchantTradeNo: s2.data.merchant_trade_no, amount: s2.data.amount },
      ]
      stub.trades.set(s2.data.merchant_trade_no, { status: "1", amount: s2.data.amount })
      const r = await run()
      expect(r).toMatchObject({ ok: 1, recovered: [] })
      expect(r.alerts).toEqual([expect.stringContaining(`${s2.data.merchant_trade_no} (TradeNo`)])
      expect(r.alerts[0]).toContain("paid_twice")
      expect(await h.capturedPayments(s2.id)).toHaveLength(0)
    })

    const pg = () => getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)

    it("a capture whose session is older than the session window is still checked (sessions looked up by id)", async () => {
      const c = await h.checkout()
      expect((await h.postNotice(h.paidNotice(c.sessionData, c.session, { PaymentDate: ecpayDate(today()) }))).data).toEqual("1|OK")
      await pg().raw("update payment_session set created_at = created_at - interval '20 days' where id = ?", [c.session.id])
      const r = await run()
      expect(r.alerts.join()).toContain(`${c.sessionData.merchant_trade_no} is captured in Medusa but ECPay does not list it`)
    })

    it("a captured ECPay payment whose session has no trade number alerts instead of being skipped", async () => {
      const c = await h.checkout()
      expect((await h.postNotice(h.paidNotice(c.sessionData, c.session, { PaymentDate: ecpayDate(today()) }))).data).toEqual("1|OK")
      await pg().raw("update payment_session set data = data - 'merchant_trade_no' where id = ?", [c.session.id])
      const r = await run()
      expect(r.alerts.join()).toContain(`(${c.session.id}) has no ECPay trade number`)
    })

    it("ECPay's error row (one file per minute) is reported, not read as 'no trades'", async () => {
      stub.state.fileError = "一分鐘之內僅限下載一個媒體檔"
      const r = await run()
      expect(r).toMatchObject({ file: "error", error: "一分鐘之內僅限下載一個媒體檔" })
    })
  },
})
