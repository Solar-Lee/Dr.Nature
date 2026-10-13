// [P4-09 review, design H2] An admin cancel takes no collection lock, so it can race a payment
// being recorded (src/lib/ecpay/cancel-race.ts). Both commit orders, made deterministic:
//  - the cancel commits between recordVerifiedPayment's pre-check and the capture: the
//    notice-attach workflow is wrapped (jest.mock) to run the REAL cancelOrderWorkflow right
//    after attaching the proof, i.e. after the pre-check read the order as pending;
//  - the capture commits before the cancel finished, so the cancel's refund step missed it: that
//    outcome (canceled, captured, no refund) is set up with the order module, then
//    order.canceled is emitted for the subscriber.
// What this cannot prove: the timing of a real race between two HTTP requests, and the Redis
// event bus delivering order.canceled in production (tests use the local event bus).
//
// Run: cd apps/backend && ../../infra/test-env.sh env TEST_TYPE=integration:http \
//   NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --forceExit integration-tests/http/ecpay-cancel-race.spec.ts
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import { openCapturesOnCanceledOrder } from "../../src/lib/ecpay/cancel-race"
import { recordVerifiedPayment } from "../../src/lib/ecpay/record-payment"
import { addTestShipping, makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"

jest.setTimeout(180 * 1000)

type Race = { orderId: string | null; canceled: boolean }
const race = (): Race => ((globalThis as { mockCancelRace?: Race }).mockCancelRace ??= { orderId: null, canceled: false })

jest.mock("../../src/workflows/ecpay/attach-ecpay-notice", () => {
  const actual = jest.requireActual("../../src/workflows/ecpay/attach-ecpay-notice")
  const { cancelOrderWorkflow } = jest.requireActual("@medusajs/medusa/core-flows")
  return {
    ...actual,
    attachEcpayNoticeWorkflow: (container: unknown) => ({
      run: async (args: unknown) => {
        const out = await actual.attachEcpayNoticeWorkflow(container).run(args)
        const r = (globalThis as { mockCancelRace?: Race }).mockCancelRace
        if (r?.orderId) {
          const orderId = r.orderId
          r.orderId = null
          await cancelOrderWorkflow(container).run({ input: { order_id: orderId } })
          r.canceled = true
        }
        return out
      },
    }),
  }
})

const eventually = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> => {
  const end = Date.now() + ms
  let v = await read()
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 100))
    v = await read()
  }
  return v
}

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const { checkout, postNotice, paidNotice, capturedPayments, superAdminHeaders } = makeCheckoutHelpers({ api, getContainer })

    beforeAll(async () => {
      const container = getContainer()
      await runAllSeeds(container)
      await addTestShipping(container)
      await devAddTestStock({ container, args: [] } as any)
    })

    const orderOf = (id: string) => getContainer().resolve(Modules.ORDER).retrieveOrder(id)

    it("the cancel commits between the pre-check and the capture: flagged, alerted, paid_after_cancel", async () => {
      const { session, sessionData, completion } = await checkout()
      const notice: Record<string, string> = paidNotice(sessionData, session)
      race().orderId = completion.order.id
      race().canceled = false
      const outcome = await recordVerifiedPayment(
        getContainer(),
        {
          session: { id: session.id, payment_collection_id: session.payment_collection_id },
          proofKey: "ecpay_notice",
          proof: notice,
          merchantTradeNo: notice.MerchantTradeNo,
          tradeNo: notice.TradeNo,
          amount: Number(notice.TradeAmt),
          paymentDate: notice.PaymentDate,
        },
        "test race"
      )
      expect(race().canceled).toBe(true)
      // The capture still happened (the cancel's refund step read no capture): it must be reported.
      expect(await capturedPayments(session.id)).toHaveLength(1)
      expect(outcome).toEqual("paid_after_cancel")
      const order = await orderOf(completion.order.id)
      expect(order.status).toEqual("canceled")
      expect(order.metadata?.ecpay_paid_after_cancel).toMatchObject({
        merchant_trade_no: sessionData.merchant_trade_no,
        amount: sessionData.amount,
      })
    })

    it("the capture commits before the cancel finished: the order.canceled subscriber flags the unrefunded capture", async () => {
      const { session, sessionData, completion } = await checkout()
      expect((await postNotice(paidNotice(sessionData, session))).data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(1)
      // The outcome of the lost race: canceled, the capture never refunded.
      await getContainer().resolve(Modules.ORDER).cancel(completion.order.id)
      expect((await orderOf(completion.order.id)).metadata?.ecpay_paid_after_cancel).toBeUndefined()
      await getContainer().resolve(Modules.EVENT_BUS).emit({ name: "order.canceled", data: { id: completion.order.id } })
      const order = await eventually(() => orderOf(completion.order.id), (o) => !!o.metadata?.ecpay_paid_after_cancel)
      expect(order.metadata?.ecpay_paid_after_cancel).toMatchObject({
        merchant_trade_no: sessionData.merchant_trade_no,
        amount: sessionData.amount,
      })
    })

    it("a normal admin cancel of a paid order refunds through Medusa and is not flagged", async () => {
      const { session, sessionData, completion } = await checkout()
      expect((await postNotice(paidNotice(sessionData, session))).data).toEqual("1|OK")
      const admin = await superAdminHeaders("race-normal@drn.test")
      expect((await api.post(`/admin/orders/${completion.order.id}/cancel`, {}, { headers: admin, validateStatus: () => true })).status).toEqual(200)
      expect(await openCapturesOnCanceledOrder(getContainer(), completion.order.id)).toEqual([])
      await new Promise((r) => setTimeout(r, 1000))
      expect((await orderOf(completion.order.id)).metadata?.ecpay_paid_after_cancel).toBeUndefined()
    })

    it("an unpaid order canceled by staff: nothing to flag", async () => {
      const { completion } = await checkout()
      const admin = await superAdminHeaders("race-unpaid@drn.test")
      expect((await api.post(`/admin/orders/${completion.order.id}/cancel`, {}, { headers: admin, validateStatus: () => true })).status).toEqual(200)
      expect(await openCapturesOnCanceledOrder(getContainer(), completion.order.id)).toEqual([])
    })
  },
})
