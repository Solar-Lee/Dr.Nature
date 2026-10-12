// [P4-11] The shopper picks a new pickup store after ECPay reported the old one closed
// (status meaning "reselect_store": 2104 / 7011 / 2037 / 2101 / 2103 / 2028 ...).
// Deadline at ECPay: 7-ELEVEN and FamilyMart by 10:00 on the 7th day, Hi-Life by 10:00 on the
// 3rd day (C2C manuals); after that the parcel goes back. The storefront opens the e-map
// (GET /store/ecpay/logistics/map-form) and relays the chosen store here; we send it to
// ECPay (UpdateStoreInfo, StoreType 01) and record it only when ECPay answers "1|OK".
// Body: { email (guests), store: { LogisticsSubType, CVSStoreID, CVSStoreName, CVSAddress, ... } }
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ecpayLogisticsOptionsFromEnv } from "../../../../../../lib/ecpay/config"
import { buildUpdateStoreInfoRequest, parseChosenStore, type CvsSubtype } from "../../../../../../lib/ecpay/logistics"
import { postLogistics } from "../../../../../../lib/ecpay/logistics-client"
import { orderWithShipments } from "../../../../../../lib/ecpay/order-shipments"
import { assertOrderOwner } from "../../../../../../lib/order-owner"
import { updateEcpayShipmentWorkflow } from "../../../../../../workflows/ecpay/update-ecpay-shipment"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as { email?: unknown; store?: unknown }
  const { order, shipments } = await orderWithShipments(req.scope, req.params.id)
  assertOrderOwner(order, req.auth_context?.actor_id, body.email)
  const waiting = shipments.filter((f) => (f.metadata?.ecpay_status as { meaning?: string } | undefined)?.meaning === "reselect_store")
  if (waiting.length !== 1) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "目前沒有需要重選門市的包裹")
  }
  const f = waiting[0]
  const d = f.data ?? {}
  const store = parseChosenStore((body.store ?? {}) as Record<string, unknown>, d.logistics_subtype as CvsSubtype)
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
        storeType: "01",
        storeId: store.store_id,
      }
    )
  )
  if (!r.ok) {
    res.status(422).json({ message: `綠界無法變更門市：${r.message}` })
    return
  }
  await updateEcpayShipmentWorkflow(req.scope).run({
    input: { fulfillment_id: f.id, store, update: { at: new Date().toISOString(), store_type: "01", store_id: store.store_id, by: "shopper" } },
  })
  res.json({ store })
}
