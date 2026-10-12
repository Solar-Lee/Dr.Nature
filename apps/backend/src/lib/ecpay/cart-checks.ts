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
import { receiverProblem, type ReceiverAddress } from "./logistics"

export type CartView = {
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

// Live checks are bounded: one ECPay call per checkout, 5 s, and only a definite "invalid"
// blocks (ECPay down -> accepted; a bad barcode is then caught when issuing). A public
// lookup endpoint is deliberately NOT offered: ECPay blocks the merchant for ~30 minutes
// when rate-limited (HTTP 403), which would stop all invoicing.
const LIVE_CHECK_TIMEOUT_MS = 5_000

export async function checkEcpayInvoiceCart(cart: CartView, container: MedusaContainer) {
  const raw = cart.metadata?.ecpay_invoice_choice
  if (raw === undefined || raw === null) {
    return // default: ECPay member carrier, keyed to the order e-mail
  }
  const parsed = parseInvoiceChoice(raw)
  if (!parsed.ok) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.message)
  }
  if (!ecpayInvoiceConfigured()) {
    return
  }
  const c = parsed.choice
  const options = ecpayInvoiceOptionsFromEnv()
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (c.type === "mobile_barcode") {
    const r = await invoiceCall(options, "CheckBarcode", { BarCode: c.barcode }, LIVE_CHECK_TIMEOUT_MS)
    if (r.ok && r.data.IsExist === "N") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "查無此手機條碼，請確認後再試")
    }
    if (!r.ok) logger.warn(`CheckBarcode unavailable, accepted ${c.barcode}: ${r.message}`)
  } else if (c.type === "donation") {
    const r = await invoiceCall(options, "CheckLoveCode", { LoveCode: c.love_code }, LIVE_CHECK_TIMEOUT_MS)
    if (r.ok && r.data.IsExist === "N") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "查無此捐贈碼，請確認後再試")
    }
    if (!r.ok) logger.warn(`CheckLoveCode unavailable, accepted ${c.love_code}: ${r.message}`)
  } else if (c.type === "company") {
    const r = await invoiceCall(options, "GetCompanyNameByTaxID", { UnifiedBusinessNo: c.tax_id }, LIVE_CHECK_TIMEOUT_MS)
    // Only a failed check digit or a wrong length is definite (INV-13; 1200125 seen on stage).
    if (!r.ok && !r.transport && /^RtnCode (1200125|2027000):/.test(r.message)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "統一編號有誤，請確認後再試")
    }
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
