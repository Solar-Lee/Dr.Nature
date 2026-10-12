// [P4-06] Canceled order -> reconcile its e-invoice under the same per-order lock as issuing:
// a valid invoice (recorded, or found at ECPay after a lost answer) raises [ECPAY-ALERT].
// Voiding needs the buyer's consent (電子發票實施作業要點 第九點), so it is never automatic:
// staff void through POST /admin/orders/:id/ecpay-invoice/void, or issue an allowance after
// the void deadline. Nothing is ever issued for a canceled order.
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ecpayInvoiceConfigured } from "../lib/ecpay/config"
import { issueEcpayInvoiceWorkflow } from "../workflows/ecpay/issue-ecpay-invoice"

export default async function ecpayInvoiceCanceledHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  if (!ecpayInvoiceConfigured()) {
    return
  }
  try {
    await issueEcpayInvoiceWorkflow(container).run({ input: { order_id: event.data.id } })
  } catch (e) {
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`[ECPAY-ALERT] e-invoice reconcile for canceled order ${event.data.id} errored: ${(e as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
  context: { subscriberId: "drn-ecpay-invoice-canceled" },
}
