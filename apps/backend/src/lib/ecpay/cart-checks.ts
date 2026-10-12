// Checks run when a cart completes (src/workflows/hooks/complete-cart-validate.ts; Medusa
// allows ONE handler per hook, so every check lives here).
//  - [P4-05] ECPay pickup data: Medusa validates shipping-method data only when the method is
//    added (validateFulfillmentData); a later address change is not re-checked, and ECPay
//    would then refuse the shipment of an already-placed order.
//  - [P4-06] e-invoice choice (cart.metadata.ecpay_invoice_choice, copied to the order).
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { ECPAY_LOGISTICS_PROVIDER_ID, ecpayInvoiceConfigured, ecpayInvoiceOptionsFromEnv } from "./config"
import { parseInvoiceChoice } from "./invoice"
import { invoiceCall } from "./invoice-client"
import { cachedLookup, rememberLookup, takeLookupBudget } from "./lookup-guard"
import { receiverProblem, type ReceiverAddress } from "./logistics"

export type CartView = {
  completed_at?: unknown
  metadata?: Record<string, unknown> | null
  shipping_address?: ReceiverAddress | null
  shipping_methods?: { shipping_option_id?: string | null; data?: Record<string, unknown> | null }[] | null
}

export async function checkEcpayLogisticsCart(cart: CartView, container: MedusaContainer) {
  const methods = (cart.shipping_methods ?? []).filter((m) => m?.shipping_option_id)
  if (!methods.length) {
    return
  }
  const options = await container.resolve(Modules.FULFILLMENT).listShippingOptions(
    { id: methods.map((m) => m.shipping_option_id!) },
    { select: ["id", "provider_id"] }
  )
  const ecpayOptionIds = new Set(options.filter((o) => o.provider_id === ECPAY_LOGISTICS_PROVIDER_ID).map((o) => o.id))
  const ecpayMethods = methods.filter((m) => ecpayOptionIds.has(m.shipping_option_id!))
  if (!ecpayMethods.length) {
    return
  }
  const problem = receiverProblem(cart.shipping_address)
  if (problem) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, problem)
  }
  for (const m of ecpayMethods) {
    const store = m.data?.store as { store_id?: unknown } | undefined
    if (m.data?.logistics_type === "CVS" && !(typeof store?.store_id === "string" && store.store_id)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "請先選擇取貨門市")
    }
  }
}

// Live checks are bounded (lookup-guard.ts): at most one ECPay call per checkout, none for
// a cart that is already completed, a per-process budget, a cache, 5 s timeout. Only a
// definite "invalid" blocks; ECPay down, rate-limited or misconfigured -> accepted (a bad
// value then surfaces when the invoice is issued). No public lookup endpoint is offered.
const LIVE_CHECK_TIMEOUT_MS = 5_000

const mask = (v: string) => `${v.slice(0, 3)}${"*".repeat(Math.max(0, v.length - 3))}`

export async function checkEcpayInvoiceCart(cart: CartView, container: MedusaContainer) {
  const raw = cart.metadata?.ecpay_invoice_choice
  if (raw === undefined || raw === null) {
    return // default: ECPay member carrier, keyed to the order e-mail
  }
  const parsed = parseInvoiceChoice(raw)
  if (!parsed.ok) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.message)
  }
  const c = parsed.choice
  if (cart.completed_at || !ecpayInvoiceConfigured() || c.type === "member" || c.type === "citizen_cert") {
    return
  }
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  let options
  try {
    options = ecpayInvoiceOptionsFromEnv()
  } catch (e) {
    logger.error(`[ECPAY-ALERT] e-invoice config error, checkout lookups skipped: ${(e as Error).message}`)
    return
  }
  const lookup =
    c.type === "mobile_barcode"
      ? { key: `barcode:${c.barcode}`, path: "CheckBarcode" as const, data: { BarCode: c.barcode }, shown: mask(c.barcode), message: "查無此手機條碼，請確認後再試" }
      : c.type === "donation"
        ? { key: `love:${c.love_code}`, path: "CheckLoveCode" as const, data: { LoveCode: c.love_code }, shown: c.love_code, message: "查無此捐贈碼，請確認後再試" }
        : { key: `taxid:${c.tax_id}`, path: "GetCompanyNameByTaxID" as const, data: { UnifiedBusinessNo: c.tax_id }, shown: c.tax_id, message: "統一編號有誤，請確認後再試" }
  const known = cachedLookup(lookup.key)
  if (known === "invalid") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, lookup.message)
  }
  if (known === "valid") {
    return
  }
  if (!takeLookupBudget()) {
    logger.warn(`e-invoice checkout lookup budget used up; accepted ${c.type} ${lookup.shown} unchecked`)
    return
  }
  const r = await invoiceCall(options, lookup.path, lookup.data, LIVE_CHECK_TIMEOUT_MS)
  let verdict: "valid" | "invalid" | undefined
  if (lookup.path === "GetCompanyNameByTaxID") {
    // Only a failed check digit or a wrong length is definite (INV-13; 1200125 seen on stage).
    verdict = r.ok ? "valid" : !r.transport && /^RtnCode (1200125|2027000):/.test(r.message) ? "invalid" : undefined
  } else if (r.ok) {
    verdict = r.data.IsExist === "N" ? "invalid" : r.data.IsExist === "Y" ? "valid" : undefined
  }
  if (!verdict) {
    logger.warn(`${lookup.path} unavailable; accepted ${c.type} ${lookup.shown}: ${r.ok ? "no IsExist" : r.message}`)
    return
  }
  rememberLookup(lookup.key, verdict)
  if (verdict === "invalid") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, lookup.message)
  }
}

// cart.metadata is shopper-controlled and is copied whole onto the order (Medusa 2.21.2
// complete-cart.js), where our own records live (ecpay_invoice, ecpay_paid_after_cancel...).
// A planted `ecpay_invoice: { status: "issued" }` would stop the real invoice from being
// issued, so shoppers may set only the keys listed here.
const SHOPPER_ECPAY_KEYS = ["ecpay_invoice_choice"]

export function checkReservedCartMetadata(cart: CartView) {
  const planted = Object.keys(cart.metadata ?? {}).filter((k) => k.startsWith("ecpay_") && !SHOPPER_ECPAY_KEYS.includes(k))
  if (planted.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `cart metadata key(s) not allowed: ${planted.join(", ")}`)
  }
}
