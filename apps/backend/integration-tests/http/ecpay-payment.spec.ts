// P4-03 acceptance: ECPay credit-card flow end to end through the real store API and the
// ReturnURL route. ECPay itself is replaced by a local QueryTradeInfo stub on
// ECPAY_API_BASE_URL (infra/test-env.sh) that signs its answers with the PUBLIC sandbox
// keys; notices are signed the same way. What this cannot prove: ECPay's real stage
// servers accepting our form and calling our ReturnURL (needs a public HTTPS URL; P4-04).
//
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
import http from "http"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { computeCheckMacValue, verifyCheckMacValue } from "../../src/lib/ecpay/check-mac-value"
import { ECPAY_PROVIDER_ID } from "../../src/lib/ecpay/config"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import catalog from "../../src/data/catalog.json"
import { PUBLISHABLE_KEYS } from "../../src/lib/drn-setup"
import {
  MAC,
  MERCHANT_ID,
  addTestShipping,
  makeCheckoutHelpers,
  runAllSeeds,
} from "../helpers/ecpay-checkout"

jest.setTimeout(180 * 1000)

const STUB_URL = new URL(process.env.ECPAY_API_BASE_URL as string)

// ---- QueryTradeInfo stub ---------------------------------------------------------------
type Trade = { status: string; amount: number }
const trades = new Map<string, Trade>()
let stubRequests = 0
let stubBadSignatures = 0
const stub = http.createServer((req, res) => {
  let raw = ""
  req.on("data", (c) => (raw += c))
  req.on("end", () => {
    stubRequests++
    const params = Object.fromEntries(new URLSearchParams(raw))
    if (req.url !== "/Cashier/QueryTradeInfo/V5" || !verifyCheckMacValue(params, MAC)) {
      stubBadSignatures++
      res.writeHead(400).end("bad request")
      return
    }
    const t = trades.get(params.MerchantTradeNo) ?? { status: "10200095", amount: 0 }
    const fields = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: params.MerchantTradeNo,
      TradeNo: `T${params.MerchantTradeNo.slice(-10)}`,
      TradeAmt: String(t.amount),
      TradeStatus: t.status,
      PaymentType: "Credit_CreditCard",
    }
    res.writeHead(200, { "content-type": "text/html" })
    res.end(new URLSearchParams({ ...fields, CheckMacValue: computeCheckMacValue(fields, MAC) }).toString())
  })
})

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    beforeAll(async () => {
      await new Promise<void>((resolve) => stub.listen(Number(STUB_URL.port), STUB_URL.hostname, resolve))
      const container = getContainer()
      await runAllSeeds(container)
      await addTestShipping(container)
      await devAddTestStock({ container, args: [] } as any)
    })
    afterAll(async () => {
      await new Promise<void>((resolve) => stub.close(() => resolve()))
    })
    beforeEach(() => {
      trades.clear()
      stubRequests = 0
      stubBadSignatures = 0
    })

    const {
      storeHeaders,
      superAdminHeaders,
      checkout,
      postNotice,
      postPaymentInfo,
      codeIssuedNotice,
      sessionData,
      capturedPayments,
      paidNotice,
    } = makeCheckoutHelpers({ api, getContainer })

    it("region offers ECPay only (pp_system_default removed)", async () => {
      const headers = await storeHeaders()
      const { data } = await api.get("/store/regions?fields=*payment_providers", { headers })
      expect(data.regions[0].payment_providers.map((p: any) => p.id)).toEqual([ECPAY_PROVIDER_ID])
    })

    it("session carries a signed checkout form and no merchant keys", async () => {
      const { session, sessionData } = await checkout()
      const form = sessionData.checkout_form
      expect(form.action).toEqual("https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5")
      expect(form.fields).toMatchObject({
        MerchantID: MERCHANT_ID,
        TotalAmount: String(catalog.products[0].price),
        ChoosePayment: "Credit",
        CustomField1: session.id,
        ReturnURL: "http://localhost:9000/hooks/ecpay/payment",
      })
      expect(verifyCheckMacValue(form.fields, MAC)).toBe(true)
      expect(JSON.stringify(session)).not.toContain(MAC.hashKey)
      expect(JSON.stringify(session)).not.toContain(MAC.hashIV)
    })

    it("completing the cart before payment creates an order awaiting payment", async () => {
      const { completion, session } = await checkout()
      expect(completion.type).toEqual("order")
      expect(await capturedPayments(session.id)).toHaveLength(0)
      expect(stubRequests).toEqual(0) // no ECPay round-trip in the checkout hot path
    })

    it("signed paid notice -> exactly '1|OK' and the order's payment is captured (no ECPay query)", async () => {
      const { session, sessionData, completion } = await checkout()
      // QueryTradeInfo would still say "unpaid" (ECPay documents a lag): the signed notice is the proof.
      trades.set(sessionData.merchant_trade_no, { status: "0", amount: sessionData.amount })
      const res = await postNotice(paidNotice(sessionData, session))
      expect(res.status).toEqual(200)
      expect(res.data).toEqual("1|OK")
      const captured = await capturedPayments(session.id)
      expect(captured).toHaveLength(1)
      expect(Number(captured[0].amount)).toEqual(sessionData.amount)
      const { data: order } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "order", fields: ["id", "payment_collections.status"], filters: { id: completion.order.id } })
      expect(order[0].payment_collections?.[0]?.status).toEqual("completed")
      expect(stubRequests).toEqual(0)
    })

    it("duplicate paid notice is acknowledged again without a second payment", async () => {
      const { session, sessionData } = await checkout()
      trades.set(sessionData.merchant_trade_no, { status: "1", amount: sessionData.amount })
      const body = paidNotice(sessionData, session)
      expect((await postNotice(body)).data).toEqual("1|OK")
      expect((await postNotice(body)).data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(1)
    })

    it("tampered notice (amount edited after signing) -> 400, nothing captured", async () => {
      const { session, sessionData } = await checkout()
      trades.set(sessionData.merchant_trade_no, { status: "1", amount: sessionData.amount })
      const res = await postNotice({ ...paidNotice(sessionData, session), TradeAmt: "1" })
      expect(res.status).toEqual(400)
      expect(res.data).not.toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(0)
    })

    it("notice signed with another merchant's keys -> 400, nothing captured", async () => {
      const { session, sessionData } = await checkout()
      trades.set(sessionData.merchant_trade_no, { status: "1", amount: sessionData.amount })
      const fields = { ...paidNotice(sessionData, session) }
      delete (fields as any).CheckMacValue
      const forged = {
        ...fields,
        CheckMacValue: computeCheckMacValue(fields, { ...MAC, hashKey: "5294y06JbISpM5x9", hashIV: "v77hoKGq4kWxNNIS" }),
      }
      expect((await postNotice(forged)).status).toEqual(400)
      expect(await capturedPayments(session.id)).toHaveLength(0)
    })

    it("notice pointing at another session's trade -> 400 session mismatch", async () => {
      const a = await checkout()
      const b = await checkout()
      const res = await postNotice(paidNotice(a.sessionData, b.session))
      expect(res.status).toEqual(400)
      expect(await capturedPayments(a.session.id)).toHaveLength(0)
      expect(await capturedPayments(b.session.id)).toHaveLength(0)
    })

    it.each([
      ["SimulatePaid=1", { SimulatePaid: "1" }],
      ["RtnCode != 1", { RtnCode: "10100248", RtnMsg: "拒絕交易" }],
    ])("%s is acknowledged but captures nothing", async (_n, extra) => {
      const { session, sessionData } = await checkout()
      trades.set(sessionData.merchant_trade_no, { status: "1", amount: sessionData.amount })
      const res = await postNotice(paidNotice(sessionData, session, extra))
      expect(res.data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(0)
    })

    it("signed notice with a different amount is acknowledged but never captured", async () => {
      const { session, sessionData } = await checkout()
      trades.set(sessionData.merchant_trade_no, { status: "1", amount: 1 })
      const res = await postNotice(paidNotice(sessionData, session, { TradeAmt: "1" }))
      expect(res.data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(0)
    })

    it("duplicate paid notice after a paid order was canceled is not flagged as paid-after-cancel", async () => {
      const { session, sessionData: data, completion } = await checkout()
      expect((await postNotice(paidNotice(data, session))).data).toEqual("1|OK")
      const admin = await superAdminHeaders("dup-cancel@drn.test")
      expect((await api.post(`/admin/orders/${completion.order.id}/cancel`, {}, { headers: admin, validateStatus: () => true })).status).toEqual(200)
      expect((await postNotice(paidNotice(data, session))).data).toEqual("1|OK")
      const order = await getContainer().resolve(Modules.ORDER).retrieveOrder(completion.order.id)
      expect(order.metadata?.ecpay_paid_after_cancel).toBeUndefined()
      expect(await capturedPayments(session.id)).toHaveLength(1)
    })

    it("instructions a shopper plants at session creation are wiped", async () => {
      const headers = await storeHeaders()
      const { cartId } = await checkout({ complete: false, choosePayment: "ATM" })
      const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, { headers })
      const { data: ps } = await api.post(
        `/store/payment-collections/${pc.payment_collection.id}/payment-sessions`,
        {
          provider_id: ECPAY_PROVIDER_ID,
          data: { choose_payment: "ATM", ecpay_payment_instructions: { bank_code: "999", v_account: "attacker" }, ecpay_notice: {} },
        },
        { headers }
      )
      const planted = ps.payment_collection.payment_sessions[0].data
      expect(planted.ecpay_payment_instructions).toBeNull()
      expect(planted.ecpay_notice).toBeNull()
    })

    it("re-paying an already placed order through a new session is refused", async () => {
      const { paymentCollectionId, headers } = await checkout()
      const res = await api.post(
        `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
        { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } },
        { headers, validateStatus: () => true }
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(JSON.stringify(res.data)).toContain("already been placed")
    })

    it("paid notice before the cart was completed creates the order and captures it", async () => {
      const { session, sessionData, cartId } = await checkout({ complete: false })
      const res = await postNotice(paidNotice(sessionData, session))
      expect(res.data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(1)
      const { data: links } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "order_cart", fields: ["cart_id"], filters: { cart_id: cartId } })
      expect(links).toHaveLength(1)
    })

    it("payment arriving for a canceled order is recorded on the order, alerted and not captured", async () => {
      const { session, sessionData, completion } = await checkout()
      const admin = await superAdminHeaders("cancel@drn.test")
      const cancel = await api.post(`/admin/orders/${completion.order.id}/cancel`, {}, { headers: admin, validateStatus: () => true })
      expect(cancel.status).toEqual(200)
      const res = await postNotice(paidNotice(sessionData, session))
      expect(res.data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(0)
      const order = await getContainer().resolve(Modules.ORDER).retrieveOrder(completion.order.id)
      expect(order.metadata?.ecpay_paid_after_cancel).toMatchObject({
        merchant_trade_no: sessionData.merchant_trade_no,
        amount: sessionData.amount,
      })
    })

    it("a paid order can be canceled; the refund is recorded as manual_pending for the back office", async () => {
      const { session, sessionData, completion } = await checkout()
      expect((await postNotice(paidNotice(sessionData, session))).data).toEqual("1|OK")
      const admin = await superAdminHeaders("refund@drn.test")
      const cancel = await api.post(`/admin/orders/${completion.order.id}/cancel`, {}, { headers: admin, validateStatus: () => true })
      expect(cancel.status).toEqual(200)
      const { data: payments } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "payment", fields: ["id", "data", "refunds.amount"], filters: { payment_session_id: session.id } })
      expect(payments[0].refunds?.map((r: any) => Number(r.amount))).toEqual([sessionData.amount])
      expect((payments[0].data as any).ecpay_manual_refunds).toEqual([
        expect.objectContaining({ amount: sessionData.amount, status: "manual_pending" }),
      ])
    })

    it("Medusa's built-in /hooks/payment route is closed for ECPay: a replayed signed notice changes nothing", async () => {
      const { session, sessionData: data, completion, paymentCollectionId } = await checkout()
      const admin = await superAdminHeaders("builtin-hook@drn.test")
      expect((await api.post(`/admin/orders/${completion.order.id}/cancel`, {}, { headers: admin, validateStatus: () => true })).status).toEqual(200)
      for (const provider of ["ecpay_ecpay", "pp_ecpay_ecpay"]) {
        const res = await api.post(`/hooks/payment/${provider}`, new URLSearchParams(paidNotice(data, session)).toString(), {
          headers: { "content-type": "application/x-www-form-urlencoded" },
          validateStatus: () => true,
        })
        expect(res.status).toEqual(404)
      }
      await new Promise((r) => setTimeout(r, 500))
      expect(await capturedPayments(session.id)).toHaveLength(0)
      const { data: pcs } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "payment_collection", fields: ["status"], filters: { id: paymentCollectionId } })
      expect(pcs[0].status).toEqual("canceled")
    })

    it("paid notice for a session that was replaced before checkout -> non-ACK so ECPay keeps retrying", async () => {
      const first = await checkout({ complete: false })
      // Replace the session (allowed while the cart is not completed): the first one is deleted.
      await api.post(
        `/store/payment-collections/${first.paymentCollectionId}/payment-sessions`,
        { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } },
        { headers: first.headers }
      )
      const res = await postNotice(paidNotice(first.sessionData, first.session))
      expect(res.status).toEqual(400)
      expect(res.data).not.toEqual("1|OK")
      expect(await capturedPayments(first.session.id)).toHaveLength(0)
    })

    describe("ATM / convenience-store codes (P4-04)", () => {
      it("ATM: form asks for a code -> code issued -> instructions stored -> paid notice captures", async () => {
        const { session, sessionData: data, completion } = await checkout({ choosePayment: "ATM" })
        expect(data.checkout_form.fields).toMatchObject({
          ChoosePayment: "ATM",
          ExpireDate: "3",
          PaymentInfoURL: "http://localhost:9000/hooks/ecpay/payment-info",
        })
        expect(completion.type).toEqual("order")

        const issued = await postPaymentInfo(codeIssuedNotice(data, session, "ATM"))
        expect(issued.data).toEqual("1|OK")
        expect((await sessionData(session.id)).ecpay_payment_instructions).toMatchObject({
          payment_type: "ATM_FIRST",
          bank_code: "007",
          v_account: "9103522175887271",
          expires_at: "2026-10-16T15:59:59.000Z",
        })
        expect(await capturedPayments(session.id)).toHaveLength(0)

        const paid = await postNotice(paidNotice(data, session, { PaymentType: "ATM_FIRST" }))
        expect(paid.data).toEqual("1|OK")
        expect(await capturedPayments(session.id)).toHaveLength(1)
        // The code stays visible on the paid session for the order history.
        expect((await sessionData(session.id)).ecpay_payment_instructions?.v_account).toEqual("9103522175887271")
      })

      it("CVS: code issued (10100073) -> paid notice captures", async () => {
        const { session, sessionData: data } = await checkout({ choosePayment: "CVS" })
        expect(data.checkout_form.fields).toMatchObject({ ChoosePayment: "CVS", StoreExpireDate: "10080" })
        expect((await postPaymentInfo(codeIssuedNotice(data, session, "CVS"))).data).toEqual("1|OK")
        expect((await sessionData(session.id)).ecpay_payment_instructions).toMatchObject({ payment_no: "LLL22251222" })
        expect((await postNotice(paidNotice(data, session, { PaymentType: "CVS_CVS" }))).data).toEqual("1|OK")
        expect(await capturedPayments(session.id)).toHaveLength(1)
      })

      it("code issued before the cart was completed: the order is created, still unpaid", async () => {
        const { session, sessionData: data, cartId } = await checkout({ complete: false, choosePayment: "ATM" })
        expect((await postPaymentInfo(codeIssuedNotice(data, session, "ATM"))).data).toEqual("1|OK")
        const { data: links } = await getContainer()
          .resolve(ContainerRegistrationKeys.QUERY)
          .graph({ entity: "order_cart", fields: ["cart_id"], filters: { cart_id: cartId } })
        expect(links).toHaveLength(1)
        expect(await capturedPayments(session.id)).toHaveLength(0)
      })

      it("tampered code notice -> 400, nothing stored", async () => {
        const { session, sessionData: data } = await checkout({ choosePayment: "ATM" })
        const res = await postPaymentInfo({ ...codeIssuedNotice(data, session, "ATM"), vAccount: "0000000000000000" })
        expect(res.status).toEqual(400)
        expect((await sessionData(session.id)).ecpay_payment_instructions ?? null).toBeNull()
      })

      it("failed code issue is acknowledged without storing anything", async () => {
        const { session, sessionData: data } = await checkout({ choosePayment: "CVS" })
        const res = await postPaymentInfo(codeIssuedNotice(data, session, "CVS", { RtnCode: "10100058", RtnMsg: "失敗" }))
        expect(res.data).toEqual("1|OK")
        expect((await sessionData(session.id)).ecpay_payment_instructions ?? null).toBeNull()
      })

      it("simulated payment of a code is ignored when ECPAY_ACCEPT_SIMULATED_PAYMENTS is off", async () => {
        const { session, sessionData: data } = await checkout({ choosePayment: "ATM" })
        await postPaymentInfo(codeIssuedNotice(data, session, "ATM"))
        const res = await postNotice(paidNotice(data, session, { PaymentType: "ATM_FIRST", SimulatePaid: "1" }))
        expect(res.data).toEqual("1|OK")
        expect(await capturedPayments(session.id)).toHaveLength(0)
      })

      it("code notice for a different amount is acknowledged, nothing stored", async () => {
        const { session, sessionData: data } = await checkout({ choosePayment: "ATM" })
        const res = await postPaymentInfo(codeIssuedNotice(data, session, "ATM", { TradeAmt: "1" }))
        expect(res.data).toEqual("1|OK")
        expect((await sessionData(session.id)).ecpay_payment_instructions ?? null).toBeNull()
      })

      it("code notice pointing at another session -> 400", async () => {
        const a = await checkout({ choosePayment: "ATM" })
        const b = await checkout({ choosePayment: "ATM" })
        const res = await postPaymentInfo(codeIssuedNotice(a.sessionData, b.session, "ATM"))
        expect(res.status).toEqual(400)
        expect((await sessionData(a.session.id)).ecpay_payment_instructions ?? null).toBeNull()
      })
    })
  },
})
