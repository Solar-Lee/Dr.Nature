// [P4-06] A canceled order whose e-invoice is still valid needs staff: voiding requires the
// buyer's consent (電子發票實施作業要點 第九點), so it is never automatic. Staff record the
// consent and void through POST /admin/orders/:id/ecpay-invoice/void, or issue an allowance
// after the void deadline.
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { InvoiceRecord } from "../lib/ecpay/invoice"
import { ECPAY_INVOICE_KEY } from "../workflows/ecpay/ecpay-invoice-steps"

export default async function ecpayInvoiceCanceledHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  const order = await container.resolve(Modules.ORDER).retrieveOrder(event.data.id, { select: ["id", "metadata"] })
  const record = order.metadata?.[ECPAY_INVOICE_KEY] as InvoiceRecord | undefined
  if (record?.status === "issued") {
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(
        `[ECPAY-ALERT] order ${order.id} canceled with e-invoice ${record.invoice_no} still valid: get the buyer's consent, then void it (POST /admin/orders/${order.id}/ecpay-invoice/void) or issue an allowance`
      )
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
  context: { subscriberId: "drn-ecpay-invoice-canceled" },
}
