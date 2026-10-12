// Records a VERIFIED ECPay payment on its payment session (P4-03 ReturnURL, P4-10 reconcile).
// One path for both triggers so they can never disagree:
//  1. canceled order: a payment captured before the cancel is a duplicate (no-op); otherwise
//     the money arrived after cancellation -> recorded on the order + [ECPAY-ALERT], never
//     captured;
//  2. attach the signed proof to the session (the provider's updatePayment re-verifies it:
//     signature, trade number, session id, amount);
//  3. processPaymentWorkflow (authorize -> capture; completes the cart if needed);
//  4. confirm the payment is captured and the cart became an order, else throw (callers
//     retry: ECPay re-sends the notice; the reconcile job runs again).
// Callers verify the proof's signature and bind it to the session BEFORE calling this.
import type { MedusaContainer } from "@medusajs/framework/types"
import { BigNumber, ContainerRegistrationKeys, MedusaError, PaymentActions } from "@medusajs/framework/utils"
import { processPaymentWorkflow } from "@medusajs/medusa/core-flows"
import { attachEcpayNoticeWorkflow } from "../../workflows/ecpay/attach-ecpay-notice"
import { flagPaidAfterCancelWorkflow } from "../../workflows/ecpay/flag-paid-after-cancel"

export type VerifiedPayment = {
  session: { id: string; payment_collection_id: string }
  proofKey: "ecpay_notice" | "ecpay_trade_info"
  proof: Record<string, string>
  merchantTradeNo: string
  tradeNo: string
  amount: number
  paymentDate: string
}

export type RecordOutcome = "captured" | "duplicate_after_cancel" | "paid_after_cancel"

export async function recordVerifiedPayment(container: MedusaContainer, p: VerifiedPayment, tag: string): Promise<RecordOutcome> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: collections } = await query.graph({
    entity: "payment_collection",
    fields: ["id", "order.id", "order.status"],
    filters: { id: p.session.payment_collection_id },
  })
  const order = (collections[0] as { order?: { id: string; status: string } | null } | undefined)?.order
  if (order?.status === "canceled") {
    // Paid and captured before the cancel (the cancel already refunded it through Medusa):
    // a duplicate of a recorded payment, not money received after cancellation.
    const { data: recorded } = await query.graph({
      entity: "payment",
      fields: ["id", "captured_at"],
      filters: { payment_session_id: p.session.id },
    })
    if (recorded.some((r) => r?.captured_at)) {
      logger.info(`${tag}: duplicate for a payment captured before order ${order.id} was canceled`)
      return "duplicate_after_cancel"
    }
    await flagPaidAfterCancelWorkflow(container).run({
      input: {
        order_id: order.id,
        payment: { merchant_trade_no: p.merchantTradeNo, trade_no: p.tradeNo, amount: p.amount, payment_date: p.paymentDate },
      },
    })
    logger.error(`${tag}: [ECPAY-ALERT] paid after order ${order.id} was canceled; refund manually in the ECPay back office`)
    return "paid_after_cancel"
  }

  await attachEcpayNoticeWorkflow(container).run({
    input: { session_id: p.session.id, notice: p.proof, key: p.proofKey },
  })
  await processPaymentWorkflow(container).run({
    input: { action: PaymentActions.SUCCESSFUL, data: { session_id: p.session.id, amount: new BigNumber(p.amount) } },
  })

  const { data: payments } = await query.graph({
    entity: "payment",
    fields: ["id", "captured_at"],
    filters: { payment_session_id: p.session.id },
  })
  if (!payments.some((r) => r?.captured_at)) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "payment not captured after processing")
  }
  const { data: cartLinks } = await query.graph({
    entity: "cart_payment_collection",
    fields: ["cart_id"],
    filters: { payment_collection_id: p.session.payment_collection_id },
  })
  const cartId = cartLinks[0]?.cart_id
  if (cartId) {
    const { data: orderLinks } = await query.graph({ entity: "order_cart", fields: ["cart_id"], filters: { cart_id: cartId } })
    if (!orderLinks.length) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `cart ${cartId} has no order after payment`)
    }
  }
  return "captured"
}
