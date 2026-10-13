// P4-09 acceptance: unpaid ECPay orders are canceled after their deadline (stock released),
// but only after ECPay confirms they are unpaid; an unpaid order can be re-paid with a new ECPay
// trade by its owner once its current trade is final, and the old trade is kept; the cancel job,
// re-pay and payment recording are serialised per payment collection (reviews payments-1..4,
// cross-1, cross-4). ECPay QueryTradeInfo is a local stub (signed like real stage).
// Re-pay success paths call repayOrder with an explicit `now` (as the job tests call
// cancelUnpaidOrders); the HTTP route is exercised for ownership and wall-clock answers.
// Cannot prove: the Redis lock provider (tests run the in-memory one, per process: server and
// worker exclusion, lease renewal) and ECPay's real timings (credit page lifetime, barcode lag).
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import { cancelUnpaidOrders } from "../../src/jobs/ecpay-unpaid-cancel"
import { formatTaipeiDate } from "../../src/lib/ecpay/aio"
import { withCollectionLock } from "../../src/lib/ecpay/collection-lock"
import { repayOrder } from "../../src/lib/ecpay/repay"
import { resetTradeQueryPause } from "../../src/lib/ecpay/trade-query"
import { tradeCreatedAt } from "../../src/lib/ecpay/unpaid"
import { MAC, MERCHANT_ID, addTestShipping, makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"
import { makeTradeStub } from "../helpers/ecpay-trade-stub"

jest.setTimeout(180 * 1000)

const STUB_URL = new URL(process.env.ECPAY_API_BASE_URL as string)
const stub = makeTradeStub(MERCHANT_ID, MAC)
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (cond: () => boolean, what: string) => {
  for (let i = 0; i < 500; i++) {
    if (cond()) return
    await sleep(20)
  }
  throw new Error(`timed out waiting for ${what}`)
}

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
    const collection = async (pcId: string) => {
      const { data } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "payment_collection", fields: ["id", "status", "captured_amount"], filters: { id: pcId } })
      return data[0] as any
    }
    const reservations = async (order: any) =>
      getContainer().resolve(Modules.INVENTORY).listReservationItems({ line_item_id: order.items.map((i: any) => i.id) })
    const after = (order: any, minutes: number) => new Date(new Date(order.created_at).getTime() + minutes * MIN)
    const run = (now: Date) => cancelUnpaidOrders(getContainer(), { now, gapMs: 0 })
    // Oldest first, so [0] is the checkout trade.
    const sessionsOf = async (pcId: string) =>
      (await getContainer().resolve(Modules.PAYMENT).listPaymentSessions({ payment_collection_id: pcId })).sort(
        (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
    const repayAt = (order: any, when: number | Date, choosePayment = "Credit") =>
      repayOrder(
        getContainer(),
        { orderId: order.id, email: "buyer@drn.test", choosePayment },
        { now: typeof when === "number" ? after(order, when) : when }
      )

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

    // Also the re-entrancy regression: the job holds the collection lock, so it must record
    // through recordVerifiedPaymentHeld; the locking wrapper would wait for itself and time out.
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

    // U1 (review payments-1 / cross-1)
    it("a re-pay restarts the cancel clock at the new trade; the job then asks ECPay about every trade", async () => {
      const c = await h.checkout()
      const order = await orderOf(c.cartId)
      await sleep(2500) // the re-pay trade must start (to the second) clearly after the order
      const r = await repayAt(order, 41)
      expect(r.status).toEqual(200)
      const s2 = (r.body as any).payment_session
      const [row2] = await getContainer().resolve(Modules.PAYMENT).listPaymentSessions({ id: [s2.id] })
      const a2 = tradeCreatedAt(row2 as any)
      expect(a2.getTime()).toBeGreaterThan(new Date(order.created_at).getTime() + 1000) // premise of the next line
      stub.asked.length = 0
      // Anchored on order.created_at this run would cancel while the shopper pays the new trade.
      expect(await run(new Date(a2.getTime() + 180 * MIN - 1000))).toEqual({})
      expect((await orderOf(c.cartId)).status).toEqual("pending")
      expect((await run(new Date(a2.getTime() + 180 * MIN + 1000)))[order.id]).toEqual("canceled")
      expect(stub.asked).toEqual([s2.data.merchant_trade_no, c.sessionData.merchant_trade_no]) // newest first, old one too
    })

    // U3 (review payments-3)
    it("a payment arriving while the cancel job holds the collection is not captured onto the canceled order", async () => {
      const c = await h.checkout()
      const order = await orderOf(c.cartId)
      stub.state.delayMs = 1500
      const job = run(after(order, 181))
      await waitFor(() => stub.asked.includes(c.sessionData.merchant_trade_no), "the job's ECPay query")
      const notice = await h.postNotice(h.paidNotice(c.sessionData, c.session)) // waits for the job's lock
      expect((await job)[order.id]).toEqual("canceled")
      expect(notice.data).toEqual("1|OK")
      expect(await h.capturedPayments(c.session.id)).toHaveLength(0)
      expect((await collection(c.paymentCollectionId)).status).toEqual("canceled")
      expect((await orderOf(c.cartId)).metadata.ecpay_paid_after_cancel).toMatchObject({ merchant_trade_no: c.sessionData.merchant_trade_no })
    })

    it.each([0, 300, 1700])("notice first, cancel job %i ms later: canceled without a capture, or paid and kept, never a mix", async (offset) => {
      const c = await h.checkout()
      const order = await orderOf(c.cartId)
      stub.state.delayMs = 1000
      const notice = h.postNotice(h.paidNotice(c.sessionData, c.session))
      await sleep(offset)
      const out = await run(after(order, 181))
      expect((await notice).data).toEqual("1|OK")
      const o = await orderOf(c.cartId)
      const state = {
        order: o.status,
        captured: (await h.capturedPayments(c.session.id)).length,
        collection: (await collection(c.paymentCollectionId)).status,
        flagged: !!o.metadata?.ecpay_paid_after_cancel,
        job: out[order.id] === "canceled" ? "canceled" : "kept",
      }
      expect([
        { order: "canceled", captured: 0, collection: "canceled", flagged: true, job: "canceled" },
        { order: "pending", captured: 1, collection: "completed", flagged: false, job: "kept" },
      ]).toContainEqual(state)
    })

    describe("re-pay", () => {
      const repay = async (orderId: string, body: Record<string, unknown>) =>
        api.post(`/store/orders/${orderId}/ecpay/repay`, body, { headers: await h.storeHeaders(), validateStatus: () => true })

      it("only with the order's e-mail; a fresh credit trade is not replaced; once final a NEW trade, the old one kept", async () => {
        const c = await h.checkout()
        const order = await orderOf(c.cartId)
        expect((await repay(order.id, { email: "someone@else.test" })).status).toEqual(404)
        expect((await repay(order.id, {})).status).toEqual(404)
        expect((await repay(order.id, { email: "buyer@drn.test", choose_payment: "LinePay" })).status).toEqual(400)
        const early = await repay(order.id, { email: "BUYER@drn.test", choose_payment: "Credit" })
        expect(early.status).toEqual(409)
        expect(early.data.retry_after).toEqual(after(order, 40).toISOString())
        expect(stub.asked).toEqual([])

        const res = await repayAt(order, 41)
        expect(res.status).toEqual(200)
        const fresh = (res.body as any).payment_session
        expect(fresh.data.merchant_trade_no).toMatch(/^DN/)
        expect(fresh.data.merchant_trade_no).not.toEqual(c.sessionData.merchant_trade_no)
        expect(fresh.data.checkout_form.fields.MerchantTradeNo).toEqual(fresh.data.merchant_trade_no)
        expect(fresh.data.checkout_form.fields.CustomField1).toEqual(fresh.id)
        expect((await sessionsOf(c.paymentCollectionId)).map((s: any) => s.id)).toEqual([c.session.id, fresh.id])
        // Paying the new trade completes the order's payment.
        expect((await h.postNotice(h.paidNotice(fresh.data, fresh))).data).toEqual("1|OK")
        expect(await h.capturedPayments(fresh.id)).toHaveLength(1)
      })

      it("if the old trade was in fact paid, it is recorded instead of opening a new one", async () => {
        const c = await h.checkout()
        const order = await orderOf(c.cartId)
        stub.trades.set(c.sessionData.merchant_trade_no, { status: "1", amount: c.sessionData.amount })
        expect(await repayAt(order, 41)).toEqual({ status: 200, body: { already_paid: true } })
        expect(await h.capturedPayments(c.session.id)).toHaveLength(1)
        expect((await sessionsOf(c.paymentCollectionId)).map((s: any) => s.id)).toEqual([c.session.id])
      })

      it("ECPay unreachable: 503 and nothing changed (fail closed)", async () => {
        const c = await h.checkout()
        const order = await orderOf(c.cartId)
        stub.state.mode = "down"
        expect((await repayAt(order, 41)).status).toEqual(503)
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

      // U2 (review payments-2): no new trade while the current one can still turn paid.
      describe("only once the current trade is final", () => {
        it("credit: 409 with retry_after before 40 minutes, ECPay not asked, nothing changed", async () => {
          const c = await h.checkout()
          const order = await orderOf(c.cartId)
          const r = await repayAt(order, 39)
          expect(r).toEqual({ status: 409, body: { message: expect.any(String), retry_after: after(order, 40).toISOString() } })
          expect(stub.asked).toEqual([])
          expect((await sessionsOf(c.paymentCollectionId)).map((s: any) => s.id)).toEqual([c.session.id])
        })

        it("ApplePay: the same 40-minute rule", async () => {
          const c = await h.checkout({ choosePayment: "ApplePay" })
          const order = await orderOf(c.cartId)
          expect((await repayAt(order, 39)).status).toEqual(409)
          expect((await repayAt(order, 41)).status).toEqual(200)
        })

        // Code deadlines relative to the wall clock, so the order (placed now) predates them.
        const issue = async (method: "ATM" | "CVS" | "BARCODE", expireDate: string) => {
          const c = await h.checkout({ choosePayment: method })
          expect((await h.postPaymentInfo(h.codeIssuedNotice(c.sessionData, c.session, method, { ExpireDate: expireDate }))).data).toEqual("1|OK")
          const expiresAt = new Date((await h.sessionData(c.session.id)).ecpay_payment_instructions.expires_at)
          return { c, order: await orderOf(c.cartId), expiresAt }
        }
        const expectLiveFinalThenNew = async (method: "ATM" | "CVS" | "BARCODE", expireDate: string, graceMs: number) => {
          const { c, order, expiresAt } = await issue(method, expireDate)
          const live = await repayAt(order, new Date(expiresAt.getTime() - HOUR))
          expect(live.status).toEqual(409)
          expect((live.body as any).payment_instructions).toMatchObject({ payment_type: expect.stringContaining(method) })
          const lagging = await repayAt(order, new Date(expiresAt.getTime() + graceMs - MIN))
          expect(lagging).toEqual({ status: 409, body: { message: expect.any(String), retry_after: new Date(expiresAt.getTime() + graceMs).toISOString() } })
          expect(stub.asked).toEqual([])
          expect((await repayAt(order, new Date(expiresAt.getTime() + graceMs + MIN))).status).toEqual(200)
          expect((await sessionsOf(c.paymentCollectionId)).map((s: any) => s.id)[0]).toEqual(c.session.id)
        }

        it("ATM code: its instructions while payable, retry_after until deadline + 1 day, then a new trade", async () => {
          const d = formatTaipeiDate(new Date(Date.now() + 3 * DAY)).slice(0, 10)
          await expectLiveFinalThenNew("ATM", d, DAY)
        })

        it("CVS code: the same, deadline + 1 day", async () => {
          await expectLiveFinalThenNew("CVS", formatTaipeiDate(new Date(Date.now() + 7 * DAY)), DAY)
        })

        it("barcode: deadline + 7 days (status lags 1-5 business days)", async () => {
          const { order, expiresAt } = await issue("BARCODE", formatTaipeiDate(new Date(Date.now() + 7 * DAY)))
          expect((await repayAt(order, new Date(expiresAt.getTime() + 6 * DAY))).status).toEqual(409)
          expect((await repayAt(order, new Date(expiresAt.getTime() + 7 * DAY + MIN))).status).toEqual(200)
        })

        it("ATM chosen but no code recorded: 24 hours", async () => {
          const c = await h.checkout({ choosePayment: "ATM" })
          const order = await orderOf(c.cartId)
          expect((await repayAt(order, 23 * 60)).status).toEqual(409)
          expect((await repayAt(order, 25 * 60)).status).toEqual(200)
        })

        it("at most 5 trades per order", async () => {
          const c = await h.checkout()
          const order = await orderOf(c.cartId)
          for (let i = 0; i < 4; i++) {
            expect((await repayAt(order, 60)).status).toEqual(200)
          }
          expect(await sessionsOf(c.paymentCollectionId)).toHaveLength(5)
          expect(await repayAt(order, 60)).toEqual({ status: 409, body: { message: "重新付款次數已達上限，請聯絡客服" } })
          expect(await sessionsOf(c.paymentCollectionId)).toHaveLength(5)
        })
      })

      // U4 (reviews payments-4 / cross-4)
      it("two re-pays at once: one new trade; the other sees it and waits for it", async () => {
        const c = await h.checkout()
        const order = await orderOf(c.cartId)
        await sleep(2500) // the new trade starts > 1 s after the order, so it is not final at `now`
        stub.state.delayMs = 1000
        const now = new Date(after(order, 40).getTime() + 1000)
        const results = await Promise.all([repayAt(order, now), repayAt(order, now)])
        expect(results.map((r) => r.status).sort()).toEqual([200, 409])
        expect((results.find((r) => r.status === 409)!.body as any).retry_after).toEqual(expect.any(String))
        expect(stub.asked.filter((t) => t === c.sessionData.merchant_trade_no)).toHaveLength(1)
        expect(await sessionsOf(c.paymentCollectionId)).toHaveLength(2)
      })

      // U5
      it("a late payment on the kept old trade is captured; then paying the new trade is flagged for a refund, never captured twice", async () => {
        const c = await h.checkout()
        const order = await orderOf(c.cartId)
        const s2 = ((await repayAt(order, 41)).body as any).payment_session
        expect((await h.postNotice(h.paidNotice(c.sessionData, c.session))).data).toEqual("1|OK")
        expect(await h.capturedPayments(c.session.id)).toHaveLength(1)
        expect((await h.postNotice(h.paidNotice(s2.data, s2))).data).toEqual("1|OK")
        expect(await h.capturedPayments(s2.id)).toHaveLength(0)
        expect((await orderOf(c.cartId)).metadata.ecpay_paid_twice).toEqual([
          expect.objectContaining({ merchant_trade_no: s2.data.merchant_trade_no, amount: s2.data.amount }),
        ])
        expect(Number((await collection(c.paymentCollectionId)).captured_amount)).toEqual(c.sessionData.amount)
      })
    })

    // U6
    describe("collection lock", () => {
      it("is not re-entrant: a nested lock on the same collection times out as a conflict", async () => {
        const container = getContainer()
        const err = await withCollectionLock(container, "pc_lock_test_a", () => withCollectionLock(container, "pc_lock_test_a", async () => "inner", 1), 5).catch((e) => e)
        expect(err).toBeInstanceOf(MedusaError)
        expect(err.type).toEqual(MedusaError.Types.CONFLICT)
      })

      it("different collections nest", async () => {
        const container = getContainer()
        await expect(withCollectionLock(container, "pc_lock_test_a", () => withCollectionLock(container, "pc_lock_test_b", async () => "inner", 1), 5)).resolves.toEqual("inner")
      })

      it("an error thrown inside is re-thrown unchanged, not turned into a conflict", async () => {
        const boom = new MedusaError(MedusaError.Types.NOT_ALLOWED, "boom")
        await expect(withCollectionLock(getContainer(), "pc_lock_test_a", async () => { throw boom }, 5)).rejects.toBe(boom)
        await expect(withCollectionLock(getContainer(), "pc_lock_test_a", async () => "free again", 1)).resolves.toEqual("free again")
      })
    })
  },
})
