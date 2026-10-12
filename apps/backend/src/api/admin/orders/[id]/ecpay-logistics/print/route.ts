// [P4-11] Staff: print the C2C shipping slip(s) of an order. ECPay requires the print form
// to be posted by the BROWSER in a top-level window (no iframe; a server POST stalls), so
// this returns a page that auto-submits the form signed here (the HashKey never leaves the
// server). Open it in a new tab. ?fulfillment_id=... (default: every live shipment of one
// carrier). PrintMode for 7-ELEVEN: &mode=2 for an A6 thermal label printer.
// Alternative without the API: 7-11 ibon, FamilyMart FamiPort, Hi-Life Life-ET (SOP).
// RBAC: order:read (middlewares.ts).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ecpayLogisticsOptionsFromEnv } from "../../../../../../lib/ecpay/config"
import { autoSubmitHtml, buildPrintForm, type CvsSubtype } from "../../../../../../lib/ecpay/logistics"
import { orderWithShipments } from "../../../../../../lib/ecpay/order-shipments"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { order, shipments } = await orderWithShipments(req.scope, req.params.id)
  const wanted = typeof req.query.fulfillment_id === "string" ? shipments.filter((s) => s.id === req.query.fulfillment_id) : shipments
  const subtypes = [...new Set(wanted.map((s) => String(s.data?.logistics_subtype)))]
  if (!order || !wanted.length || subtypes.length !== 1) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "no printable ECPay shipment (one carrier at a time)")
  }
  const options = ecpayLogisticsOptionsFromEnv()
  const form = buildPrintForm(
    { merchantId: options.merchantId, hashKey: options.hashKey, hashIV: options.hashIV },
    options.environment,
    subtypes[0] as CvsSubtype,
    wanted.map((s) => ({
      allPayLogisticsId: String(s.data?.ecpay_all_pay_logistics_id),
      cvsPaymentNo: String(s.data?.ecpay_cvs_payment_no ?? ""),
      ...(s.data?.ecpay_cvs_validation_no ? { cvsValidationNo: String(s.data.ecpay_cvs_validation_no) } : {}),
    })),
    req.query.mode === "2" ? "2" : undefined
  )
  res.status(200).type("text/html").send(autoSubmitHtml(form))
}
