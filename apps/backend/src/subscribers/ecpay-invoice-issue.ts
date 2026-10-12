// [P4-06] Issues the e-invoice once an order's payment is captured.
//  - payment.captured { id: payment id }: ECPay ReturnURL / PaymentInfo flows (P4-03/P4-04).
//  - order.placed { id: order id }: covers a cart completed after its payment was captured.
// The workflow skips orders that are not yet paid, already invoiced, or canceled, and is
// safe to run twice; failures are recorded and retried by jobs/ecpay-invoice-retry.ts.
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ecpayInvoiceConfigured } from "../lib/ecpay/config"
import { issueEcpayInvoiceWorkflow } from "../workflows/ecpay/issue-ecpay-invoice"

export default async function ecpayInvoiceIssueHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  if (!ecpayInvoiceConfigured()) {
    return
  }
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  let orderId = event.data.id
  if (event.name === "payment.captured") {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "payment",
      fields: ["id", "payment_collection.order.id"],
      filters: { id: event.data.id },
    })
    orderId = (data[0] as { payment_collection?: { order?: { id?: string } | null } | null } | undefined)?.payment_collection?.order?.id ?? ""
    if (!orderId) {
      // Cart not completed yet: order.placed will trigger it.
      return
    }
  }
  try {
    const { result } = await issueEcpayInvoiceWorkflow(container).run({ input: { order_id: orderId } })
    logger.info(`e-invoice for order ${orderId} after ${event.name}: ${result.outcome}${result.reason ? ` (${result.reason})` : ""}`)
  } catch (e) {
    logger.error(`e-invoice for order ${orderId} after ${event.name} errored; the retry job will try again: ${(e as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: ["payment.captured", "order.placed"],
  context: { subscriberId: "drn-ecpay-invoice-issue" },
}
