// [P4-11] The shopper picks a new pickup store after ECPay reported the old one closed
// (status meaning "reselect_store": 2104 / 7011 / 2037 / 2101 / 2103 / 2028 ...).
// Deadline at ECPay: 7-ELEVEN and FamilyMart by 10:00 on the 7th day, Hi-Life by 10:00 on the
// 3rd day (C2C manuals); after that the parcel goes back. The storefront opens the e-map
// (GET /store/ecpay/logistics/map-form) and relays the chosen store here; we send it to
// ECPay (UpdateStoreInfo, StoreType 01).
// Body: { email (guests), store: { LogisticsSubType, CVSStoreID, CVSStoreName, CVSAddress, ... },
//         fulfillment_id (required when several parcels wait for a new store) }
//  - only the SHOPPER's pickup-store closures (PICKUP_STORE_CLOSED; 7032 = our sender store is
//    for staff, return-store route);
//  - one reselect per closure notice (for_status = the notice's code + UpdateStatusDate): a second
//    caller cannot overwrite the shopper's choice until ECPay reports a new closure; requests are
//    serialised per order and the shipments re-read under the lock (two at once -> one call);
//  - guests: full e-mail, wrong guesses throttled (lib/order-owner.ts);
//  - "1|OK" -> recorded; "0|..." -> 422, nothing recorded; no / unexpected answer -> 502,
//    [ECPAY-ALERT] and an unconfirmed history entry (ECPay may have applied it).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { ecpayLogisticsOptionsFromEnv } from "../../../../../../lib/ecpay/config"
import { PICKUP_STORE_CLOSED, buildUpdateStoreInfoRequest, parseChosenStore, type CvsSubtype } from "../../../../../../lib/ecpay/logistics"
import { postLogistics } from "../../../../../../lib/ecpay/logistics-client"
import { orderWithShipments } from "../../../../../../lib/ecpay/order-shipments"
import { assertOrderOwnerThrottled } from "../../../../../../lib/order-owner"
import { updateEcpayShipmentWorkflow } from "../../../../../../workflows/ecpay/update-ecpay-shipment"

type Status = { code?: string; updated_at?: string; meaning?: string }

const statusKey = (s: Status) => `${s.code ?? ""}@${s.updated_at ?? ""}`

type Reply = { status: number; body: Record<string, unknown> }

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as { email?: unknown; store?: unknown; fulfillment_id?: unknown }
  const { order } = await orderWithShipments(req.scope, req.params.id)
  await assertOrderOwnerThrottled(req.scope, req.params.id, order, req.auth_context?.actor_id, body.email)
  const reply = await req.scope
    .resolve(Modules.LOCKING)
    .execute(`drn-cvs-store:${req.params.id}`, () => reselect(req, body), { timeout: 10 })
    .catch((e: Error) => {
      if (e instanceof MedusaError) throw e
      return { status: 409, body: { message: "處理中，請稍後再試。" } } as Reply // lock wait timed out
    })
  res.status(reply.status).json(reply.body)
}

async function reselect(req: AuthenticatedMedusaRequest, body: { store?: unknown; fulfillment_id?: unknown }): Promise<Reply> {
  const { order, shipments } = await orderWithShipments(req.scope, req.params.id) // fresh, under the lock
  const waiting = shipments.filter((f) => {
    const s = f.metadata?.ecpay_status as Status | undefined
    if (!s || !PICKUP_STORE_CLOSED.includes(String(s.code))) return false
    const done = Array.isArray(f.metadata?.ecpay_store_updates) ? (f.metadata!.ecpay_store_updates as { store_type?: string; for_status?: string }[]) : []
    return !done.some((u) => u.store_type === "01" && u.for_status === statusKey(s))
  })
  if (!waiting.length) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "目前沒有需要重選門市的包裹")
  }
  let chosen = waiting.length === 1 ? waiting[0] : undefined
  if (typeof body.fulfillment_id === "string") {
    chosen = waiting.find((f) => f.id === body.fulfillment_id)
    if (!chosen) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "這個包裹目前不需要重選門市")
    }
  } else if (!chosen) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "有多個包裹需要重選門市，請指定 fulfillment_id")
  }
  const d = chosen.data ?? {}
  const forStatus = statusKey(chosen.metadata!.ecpay_status as Status)
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
  const update = { at: new Date().toISOString(), store_type: "01" as const, store_id: store.store_id, by: "shopper", for_status: forStatus }
  if (!r.ok && !r.uncertain) {
    return { status: 422, body: { message: `綠界無法變更門市：${r.message}` } }
  }
  if (!r.ok) {
    req.scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`[ECPAY-ALERT] UpdateStoreInfo for shipment ${String(d.ecpay_all_pay_logistics_id)} (order ${order!.id}, store ${store.store_id}) not confirmed: ${r.message}; check it in the ECPay back office`)
    await updateEcpayShipmentWorkflow(req.scope).run({ input: { fulfillment_id: chosen.id, update: { ...update, unconfirmed: true } } })
    return { status: 502, body: { message: "綠界沒有確認門市是否已變更，請聯絡客服。" } }
  }
  await updateEcpayShipmentWorkflow(req.scope).run({ input: { fulfillment_id: chosen.id, store, update } })
  return { status: 200, body: { store, fulfillment_id: chosen.id } }
}
