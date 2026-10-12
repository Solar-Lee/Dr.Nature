// P4-07 acceptance: the daily TradeNoAio reconciliation (local stub serving the CSV layout real
// stage returned) matches paid trades with Medusa, recovers paid-but-missing ones through a
// signed QueryTradeInfo + the shared recorder, ignores other merchants' rows, and alerts on
// every discrepancy. Not provable here: the production IP whitelist and real file timing.
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import { reconcileEcpayDay, taipeiDay } from "../../src/jobs/ecpay-daily-reconcile"
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

    it("captured in Medusa today but not paid in ECPay's file: alert", async () => {
      const c = await h.checkout()
      expect((await h.postNotice(h.paidNotice(c.sessionData, c.session))).data).toEqual("1|OK")
      const r = await run()
      expect(r.alerts.join()).toContain(`${c.sessionData.merchant_trade_no} is captured in Medusa but ECPay does not list it`)
    })

    it("ECPay's error row (one file per minute) is reported, not read as 'no trades'", async () => {
      stub.state.fileError = "一分鐘之內僅限下載一個媒體檔"
      const r = await run()
      expect(r).toMatchObject({ file: "error", error: "一分鐘之內僅限下載一個媒體檔" })
    })
  },
})
