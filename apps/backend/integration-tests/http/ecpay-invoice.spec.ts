// P4-06 acceptance: ECPay B2C e-invoice through the real store, payment-notice and admin
// APIs. ECPay's invoice API is a local stub (helpers/ecpay-invoice-stub.ts) speaking the real
// JSON + AES envelope and answering like real stage did on 2026-10-13
// (docs/research/ecpay-invoice-p4-06.md). Not provable here: the production merchant, the
// MOF upload, and ECPay's buyer notifications (stage never sends them).
//
// Invoicing is switched on for THIS suite only (other suites' orders must not be invoiced).
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
const INVOICE_ENV: Record<string, string> = {
  ECPAY_INVOICE_MERCHANT_ID: "2000132", // ECPay PUBLIC e-invoice sandbox (developers.ecpay.com.tw/7849/)
  ECPAY_INVOICE_HASH_KEY: "ejCk326UnaZWKisg",
  ECPAY_INVOICE_HASH_IV: "q9jcZX8Ib9LM8wYk",
  ECPAY_INVOICE_API_BASE_URL: "http://127.0.0.1:56392",
}
const previousEnv = Object.fromEntries(Object.keys(INVOICE_ENV).map((k) => [k, process.env[k]]))
Object.assign(process.env, INVOICE_ENV)

import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import catalog from "../../src/data/catalog.json"
import { retryPendingInvoices } from "../../src/jobs/ecpay-invoice-retry"
import { issueEcpayInvoiceWorkflow } from "../../src/workflows/ecpay/issue-ecpay-invoice"
import { addTestShipping, makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"
import { makeInvoiceStub } from "../helpers/ecpay-invoice-stub"

jest.setTimeout(180 * 1000)

afterAll(() => {
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const creds = { merchantId: INVOICE_ENV.ECPAY_INVOICE_MERCHANT_ID, hashKey: INVOICE_ENV.ECPAY_INVOICE_HASH_KEY, hashIV: INVOICE_ENV.ECPAY_INVOICE_HASH_IV }
const stub = makeInvoiceStub(creds)
const PRICE = catalog.products[0].price

const waitFor = async <T>(fn: () => Promise<T | undefined | null | false>, ms = 15_000): Promise<T> => {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v as T
    if (Date.now() > end) throw new Error("timed out waiting")
    await new Promise((r) => setTimeout(r, 200))
  }
}

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    beforeAll(async () => {
      await new Promise<void>((resolve) => stub.server.listen(56392, "127.0.0.1", resolve))
      const container = getContainer()
      await runAllSeeds(container)
      await addTestShipping(container)
      await devAddTestStock({ container, args: [] } as any)
    })
    afterAll(async () => {
      await new Promise<void>((resolve) => stub.server.close(() => resolve()))
    })
    beforeEach(() => {
      stub.requests.length = 0
      stub.state.mode = "ok"
    })

    const h = makeCheckoutHelpers({ api, getContainer })

    const orderOf = async (cartId: string) => {
      const { data } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "cart", fields: ["id", "order.id"], filters: { id: cartId } })
      return (data[0] as any)?.order?.id as string | undefined
    }
    const metadataOf = async (orderId: string) =>
      (await getContainer().resolve(Modules.ORDER).retrieveOrder(orderId, { select: ["id", "metadata"] })).metadata ?? {}
    const invoiceOf = async (orderId: string) => (await metadataOf(orderId)).ecpay_invoice as any
    const issueRequests = () => stub.requests.filter((r) => r.path === "Issue")

    // Order placed (unpaid), optionally with an invoice choice on the cart.
    const placeOrder = async (choice?: Record<string, unknown>) => {
      const c = await h.checkout({ complete: false })
      if (choice) {
        await api.post(`/store/carts/${c.cartId}`, { metadata: { ecpay_invoice_choice: choice } }, { headers: c.headers })
      }
      const done = await api.post(`/store/carts/${c.cartId}/complete`, {}, { headers: c.headers, validateStatus: () => true })
      return { ...c, done, orderId: await orderOf(c.cartId) }
    }
    const pay = async (c: { sessionData: any; session: any }) => {
      const res = await h.postNotice(h.paidNotice(c.sessionData, c.session))
      expect(res.data).toEqual("1|OK")
    }

    it("a paid order gets a member-carrier e-invoice automatically", async () => {
      const c = await placeOrder()
      expect(c.done.data.type).toEqual("order")
      await new Promise((r) => setTimeout(r, 500))
      expect(issueRequests()).toHaveLength(0) // not paid yet: nothing issued
      await pay(c)
      const inv = await waitFor(async () => (await invoiceOf(c.orderId!))?.status === "issued" && invoiceOf(c.orderId!))
      expect(issueRequests()).toHaveLength(1)
      expect(issueRequests()[0].data).toMatchObject({
        MerchantID: "2000132",
        RelateNumber: c.orderId!.replace(/^order_/, ""),
        CustomerEmail: "buyer@drn.test",
        Print: "0",
        Donation: "0",
        CarrierType: "1",
        TaxType: "1",
        InvType: "07",
        vat: "1",
        SalesAmount: PRICE,
        Items: [{ ItemSeq: 1, ItemCount: 1, ItemAmount: PRICE, ItemTaxType: "1" }],
      })
      expect(inv).toMatchObject({
        status: "issued",
        invoice_no: expect.stringMatching(/^LO\d{8}$/),
        random_number: expect.stringMatching(/^\d{4}$/),
        sales_amount: PRICE,
        choice: { type: "member" },
      })
      // A repeated trigger never issues twice.
      const { result } = await issueEcpayInvoiceWorkflow(getContainer()).run({ input: { order_id: c.orderId! } })
      expect(result.outcome).toEqual("already")
      expect(issueRequests()).toHaveLength(1)
    })

    it.each([
      [{ type: "mobile_barcode", barcode: "/abc+123" }, { CarrierType: "3", CarrierNum: "/ABC+123", Donation: "0" }],
      [{ type: "citizen_cert", cert: "AB12345678901234" }, { CarrierType: "2", CarrierNum: "AB12345678901234" }],
      [{ type: "donation", love_code: "168001" }, { Donation: "1", LoveCode: "168001", CarrierType: "", Print: "0" }],
      [{ type: "company", tax_id: "97025978", title: "綠界科技股份有限公司" }, { CustomerIdentifier: "97025978", CustomerName: "綠界科技股份有限公司", CarrierType: "1", Print: "0" }],
    ])("the shopper's choice %j reaches ECPay", async (choice, expected) => {
      const c = await placeOrder(choice)
      expect(c.done.data.type).toEqual("order")
      await pay(c)
      await waitFor(async () => (await invoiceOf(c.orderId!))?.status === "issued")
      expect(issueRequests()[0].data).toMatchObject(expected)
    })

    it.each([
      ["a malformed phone barcode", { type: "mobile_barcode", barcode: "ABC1234" }, "手機條碼"],
      ["a phone barcode ECPay does not know", { type: "mobile_barcode", barcode: "/NOTREAL" }, "查無此手機條碼"],
      ["an unknown donation code", { type: "donation", love_code: "999" }, "查無此捐贈碼"],
      ["a tax id with a bad check digit", { type: "company", tax_id: "12345678", title: "某公司" }, "統一編號有誤"],
      ["a paper invoice", { type: "paper" }, "請選擇發票類型"],
    ])("checkout refuses %s", async (_n, choice, message) => {
      const c = await placeOrder(choice)
      expect(c.done.status).toEqual(400)
      expect(JSON.stringify(c.done.data)).toContain(message)
      expect(c.orderId).toBeUndefined()
    })

    it("a shopper cannot plant our invoice record through cart metadata", async () => {
      const c = await h.checkout({ complete: false })
      await api.post(`/store/carts/${c.cartId}`, { metadata: { ecpay_invoice: { status: "issued", invoice_no: "XX00000000" } } }, { headers: c.headers })
      const done = await api.post(`/store/carts/${c.cartId}/complete`, {}, { headers: c.headers, validateStatus: () => true })
      expect(done.status).toEqual(400)
      expect(JSON.stringify(done.data)).toContain("ecpay_invoice")
      expect(await orderOf(c.cartId)).toBeUndefined()
    })

    it("answer lost but ECPay issued it: the invoice is adopted, never issued twice", async () => {
      const c = await placeOrder()
      stub.state.mode = "drop"
      await pay(c)
      const inv = await waitFor(async () => (await invoiceOf(c.orderId!))?.status === "issued" && invoiceOf(c.orderId!))
      expect(stub.requests.map((r) => r.path)).toEqual(["Issue", "GetIssue"])
      const held = stub.invoices.get(c.orderId!.replace(/^order_/, ""))!
      expect(inv.invoice_no).toEqual(held.invoiceNo)
      expect(inv.random_number).toEqual(held.random)
    })

    it("ECPay down: recorded as failed, then the retry job issues it exactly once", async () => {
      const c = await placeOrder()
      stub.state.mode = "down"
      await pay(c)
      const failed = await waitFor(async () => (await invoiceOf(c.orderId!))?.status === "failed" && invoiceOf(c.orderId!))
      expect(failed).toMatchObject({ attempts: 1, error: expect.stringContaining("no answer") })
      stub.state.mode = "ok"
      const outcomes = await retryPendingInvoices(getContainer())
      expect(outcomes[c.orderId!]).toEqual("issued")
      expect((await invoiceOf(c.orderId!)).status).toEqual("issued")
      const again = await retryPendingInvoices(getContainer())
      expect(again[c.orderId!]).toBeUndefined()
      expect(issueRequests().filter((r) => r.data.RelateNumber === c.orderId!.replace(/^order_/, ""))).toHaveLength(2)
      expect(stub.invoices.has(c.orderId!.replace(/^order_/, ""))).toBe(true)
    })

    it("an ECPay refusal is recorded with its reason and nothing is adopted", async () => {
      const c = await placeOrder()
      stub.state.mode = "refuse"
      await pay(c)
      const failed = await waitFor(async () => (await invoiceOf(c.orderId!))?.status === "failed" && invoiceOf(c.orderId!))
      expect(failed.error).toContain("1500019")
      expect(stub.requests.map((r) => r.path)).toEqual(["Issue", "GetIssue"])
    })

    it("canceling an invoiced order does NOT void it (buyer consent needed); staff void with consent", async () => {
      const c = await placeOrder()
      await pay(c)
      const inv = await waitFor(async () => (await invoiceOf(c.orderId!))?.status === "issued" && invoiceOf(c.orderId!))
      const admin = await h.superAdminHeaders(`void-${c.orderId}@drn.test`)
      const cancel = await api.post(`/admin/orders/${c.orderId}/cancel`, {}, { headers: admin, validateStatus: () => true })
      expect(cancel.status).toEqual(200)
      await new Promise((r) => setTimeout(r, 500))
      expect(stub.requests.filter((r) => r.path === "Invalid")).toHaveLength(0)
      expect((await invoiceOf(c.orderId!)).status).toEqual("issued")

      const url = `/admin/orders/${c.orderId}/ecpay-invoice/void`
      const noConsent = await api.post(url, { reason: "取消訂單" }, { headers: admin, validateStatus: () => true })
      expect(noConsent.status).toEqual(400)
      const support = await h.superAdminHeaders(`support-${c.orderId}@drn.test`, "support")
      const denied = await api.post(url, { reason: "取消訂單", consent: { method: "line", note: "買家 LINE 同意作廢" } }, { headers: support, validateStatus: () => true })
      expect(denied.status).toEqual(403)

      const ok = await api.post(url, { reason: "取消訂單", consent: { method: "line", note: "買家 2026/10/13 LINE 同意作廢" } }, { headers: admin, validateStatus: () => true })
      expect({ status: ok.status, body: ok.status === 200 ? null : ok.data }).toEqual({ status: 200, body: null })
      expect(stub.requests.filter((r) => r.path === "Invalid").map((r) => r.data)).toEqual([
        expect.objectContaining({ InvoiceNo: inv.invoice_no, InvoiceDate: "2026-10-13", Reason: "取消訂單" }),
      ])
      expect(await invoiceOf(c.orderId!)).toMatchObject({
        status: "voided",
        invoice_no: inv.invoice_no,
        void: { reason: "取消訂單", consent: { method: "line", note: "買家 2026/10/13 LINE 同意作廢" }, by: expect.any(String) },
      })
      const twice = await api.post(url, { reason: "x", consent: { method: "line", note: "x" } }, { headers: admin, validateStatus: () => true })
      expect(twice.status).toEqual(400)
    })

    it("void is retry-safe: ECPay already voided it (5070453) -> recorded as voided", async () => {
      const c = await placeOrder()
      await pay(c)
      await waitFor(async () => (await invoiceOf(c.orderId!))?.status === "issued")
      stub.invoices.get(c.orderId!.replace(/^order_/, ""))!.voided = true // e.g. voided in the back office
      const admin = await h.superAdminHeaders(`void2-${c.orderId}@drn.test`)
      const res = await api.post(
        `/admin/orders/${c.orderId}/ecpay-invoice/void`,
        { reason: "後台已作廢", consent: { method: "email", note: "買家來信同意" } },
        { headers: admin, validateStatus: () => true }
      )
      expect(res.status).toEqual(200)
      expect(stub.requests.filter((r) => r.path !== "Issue").map((r) => r.path)).toEqual(["Invalid", "GetIssue"])
      expect((await invoiceOf(c.orderId!)).status).toEqual("voided")
    })

    it("operations can retry issuing from the admin; support cannot", async () => {
      const c = await placeOrder()
      stub.state.mode = "down"
      await pay(c)
      await waitFor(async () => (await invoiceOf(c.orderId!))?.status === "failed")
      stub.state.mode = "ok"
      const url = `/admin/orders/${c.orderId}/ecpay-invoice/issue`
      const support = await h.superAdminHeaders(`s-${c.orderId}@drn.test`, "support")
      expect((await api.post(url, {}, { headers: support, validateStatus: () => true })).status).toEqual(403)
      const ops = await h.superAdminHeaders(`o-${c.orderId}@drn.test`, "operations")
      const res = await api.post(url, {}, { headers: ops, validateStatus: () => true })
      expect({ status: res.status, outcome: res.data?.result?.outcome }).toEqual({ status: 200, outcome: "issued" })
    })
  },
})
