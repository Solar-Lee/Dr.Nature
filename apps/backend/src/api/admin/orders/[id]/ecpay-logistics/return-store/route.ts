// [P4-11] Staff: change OUR return/sender store of a C2C shipment (StoreType 02) after ECPay
// reported the sender store closed (7032 寄件門市關轉). RBAC: order:update (middlewares.ts).
// Body: { fulfillment_id, store_id }
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ecpayLogisticsOptionsFromEnv } from "../../../../../../lib/ecpay/config"
import { buildUpdateStoreInfoRequest } from "../../../../../../lib/ecpay/logistics"
import { postLogistics } from "../../../../../../lib/ecpay/logistics-client"
import { orderWithShipments } from "../../../../../../lib/ecpay/order-shipments"
import { updateEcpayShipmentWorkflow } from "../../../../../../workflows/ecpay/update-ecpay-shipment"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as { fulfillment_id?: unknown; store_id?: unknown }
  const { order, shipments } = await orderWithShipments(req.scope, req.params.id)
  const f = shipments.find((x) => x.id === body.fulfillment_id)
  if (!order || !f) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "ECPay shipment not found on this order")
  }
  const storeId = typeof body.store_id === "string" ? body.store_id.trim() : ""
  const d = f.data ?? {}
  const options = ecpayLogisticsOptionsFromEnv()
  const r = await postLogistics(
    options,
    "/Express/UpdateStoreInfo",
    buildUpdateStoreInfoRequest(
      { merchantId: options.merchantId, hashKey: options.hashKey, hashIV: options.hashIV },
      {
        allPayLogisticsId: String(d.ecpay_all_pay_logistics_id),
        cvsPaymentNo: String(d.ecpay_cvs_payment_no ?? ""),
        ...(d.ecpay_cvs_validation_no ? { cvsValidationNo: String(d.ecpay_cvs_validation_no) } : {}),
        storeType: "02",
        storeId,
      }
    )
  )
  if (!r.ok) {
    res.status(422).json({ message: `ECPay refused: ${r.message}` })
    return
  }
  await updateEcpayShipmentWorkflow(req.scope).run({
    input: { fulfillment_id: f.id, update: { at: new Date().toISOString(), store_type: "02", store_id: storeId, by: req.auth_context.actor_id } },
  })
  res.json({ ok: true })
}
