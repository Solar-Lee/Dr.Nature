import { cachedLookup, rememberLookup, resetLookupGuard, takeLookupBudget } from "../lookup-guard"
import { relateNumberFor } from "../invoice"
import { ecpayInvoiceOptionsFromEnv } from "../config"
import { saleAmount, shouldAlertTransportFailure } from "../../../workflows/ecpay/issue-ecpay-invoice"
import { MAX_ATTEMPTS, needsInvoiceWork } from "../../../jobs/ecpay-invoice-retry"

describe("checkout lookup guard", () => {
  beforeEach(() => resetLookupGuard())

  it("allows 20 lookups per minute per process, then refuses until the window rolls", () => {
    const t = 1_000_000
    const allowed = Array.from({ length: 25 }, () => takeLookupBudget(t)).filter(Boolean)
    expect(allowed).toHaveLength(20)
    expect(takeLookupBudget(t + 59_999)).toBe(false)
    expect(takeLookupBudget(t + 60_000)).toBe(true)
  })

  it("caches definite verdicts for 6 hours", () => {
    rememberLookup("barcode:/ABC+123", "invalid", 0)
    expect(cachedLookup("barcode:/ABC+123", 6 * 60 * 60 * 1000)).toEqual("invalid")
    expect(cachedLookup("barcode:/ABC+123", 6 * 60 * 60 * 1000 + 1)).toBeUndefined()
    expect(cachedLookup("love:168001", 0)).toBeUndefined()
  })
})

describe("RelateNumber per invoice", () => {
  it("is the order ULID, with R<n> for the n-th re-issue", () => {
    expect(relateNumberFor("order_01M4RWH46TJKD18JDK77FNMV8C")).toEqual("01M4RWH46TJKD18JDK77FNMV8C")
    expect(relateNumberFor("order_01M4RWH46TJKD18JDK77FNMV8C", 2)).toEqual("01M4RWH46TJKD18JDK77FNMV8CR2")
    expect(() => relateNumberFor("order_01M4", -1)).toThrow()
    expect(() => relateNumberFor("order_01M4", 1.5)).toThrow()
  })
})

describe("issue workflow helpers", () => {
  it("alerts on transport failure attempt 3, then every 16 attempts", () => {
    const alerted = Array.from({ length: 40 }, (_, i) => i + 1).filter(shouldAlertTransportFailure)
    expect(alerted).toEqual([3, 19, 35])
  })

  it("the sale is line totals + shipping, rounded once", () => {
    expect(saleAmount({ items: [{ total: 2070.4 }, { total: 1035.3 }], shipping_total: 60 })).toEqual(3166)
    expect(saleAmount({ items: [], shipping_total: null as any })).toEqual(0)
  })
})

describe("retry job selection", () => {
  const paid = { payment_collections: [{ payments: [{ captured_at: "2026-10-13" }] }] }
  const unpaid = { payment_collections: [{ payments: [{ captured_at: null }] }] }
  const rec = (r: Record<string, unknown>) => ({ metadata: { ecpay_invoice: { relate_number: "X", updated_at: "", ...r } } })

  it.each([
    ["paid, no record", { id: "a", status: "pending", ...paid }, true],
    ["unpaid", { id: "a", status: "pending", ...unpaid }, false],
    ["paid, failed", { id: "a", status: "pending", ...paid, ...rec({ status: "failed", attempts: 3 }) }, true],
    ["paid, failed too often", { id: "a", status: "pending", ...paid, ...rec({ status: "failed", attempts: MAX_ATTEMPTS }) }, false],
    ["paid, issued", { id: "a", status: "pending", ...paid, ...rec({ status: "issued" }) }, false],
    ["paid, voided", { id: "a", status: "pending", ...paid, ...rec({ status: "voided" }) }, false],
    ["paid, re-issue pending", { id: "a", status: "pending", ...paid, ...rec({ status: "pending" }) }, true],
    ["canceled, no record (reconcile)", { id: "a", status: "canceled", ...paid }, true],
    ["canceled, failed (reconcile)", { id: "a", status: "canceled", ...paid, ...rec({ status: "failed", attempts: 1 }) }, true],
    ["canceled, re-issue pending", { id: "a", status: "canceled", ...paid, ...rec({ status: "pending" }) }, false],
  ])("%s -> %s", (_n, order, expected) => {
    expect(needsInvoiceWork(order as any)).toBe(expected)
  })
})

describe("invoice config", () => {
  const env = {
    ECPAY_ENV: "stage",
    ECPAY_INVOICE_MERCHANT_ID: "2000132",
    ECPAY_INVOICE_HASH_KEY: "ejCk326UnaZWKisg",
    ECPAY_INVOICE_HASH_IV: "q9jcZX8Ib9LM8wYk",
  }
  it("accepts the public sandbox in stage", () => {
    expect(ecpayInvoiceOptionsFromEnv(env).apiHost).toEqual("https://einvoice-stage.ecpay.com.tw")
  })
  it.each([
    ["the public test merchant in prod", { ECPAY_ENV: "prod" }],
    ["a test host override in prod", { ECPAY_ENV: "prod", ECPAY_INVOICE_MERCHANT_ID: "3111111", ECPAY_INVOICE_API_BASE_URL: "http://127.0.0.1:1" }],
    ["a 15-character key", { ECPAY_INVOICE_HASH_KEY: "ejCk326UnaZWKis" }],
    ["a 17-character IV", { ECPAY_INVOICE_HASH_IV: "q9jcZX8Ib9LM8wYkX" }],
    ["no key", { ECPAY_INVOICE_HASH_KEY: "" }],
  ])("refuses %s", (_n, o) => {
    expect(() => ecpayInvoiceOptionsFromEnv({ ...env, ...o } as any)).toThrow()
  })
})
