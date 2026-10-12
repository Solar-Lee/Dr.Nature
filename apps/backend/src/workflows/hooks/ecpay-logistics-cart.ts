// [P4-05] Re-checks ECPay pickup data when the cart completes. Medusa validates shipping-method
// data only when the method is added (validateFulfillmentData); a later address change is not
// re-checked, and ECPay would then refuse the shipment of an already-placed order.
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { ECPAY_LOGISTICS_PROVIDER_ID } from "../../lib/ecpay/config"
import { receiverProblem, type ReceiverAddress } from "../../lib/ecpay/logistics"

type CartView = {
  shipping_address?: ReceiverAddress | null
  shipping_methods?: { shipping_option_id?: string | null; data?: Record<string, unknown> | null }[] | null
}

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const methods = ((cart as CartView).shipping_methods ?? []).filter((m) => m?.shipping_option_id)
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
  const problem = receiverProblem((cart as CartView).shipping_address)
  if (problem) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, problem)
  }
  for (const m of ecpayMethods) {
    const store = m.data?.store as { store_id?: unknown } | undefined
    if (m.data?.logistics_type === "CVS" && !(typeof store?.store_id === "string" && store.store_id)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "請先選擇取貨門市")
    }
  }
})
