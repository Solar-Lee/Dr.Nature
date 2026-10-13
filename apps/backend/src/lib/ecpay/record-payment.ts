// Records a VERIFIED ECPay payment on its payment session (P4-03 ReturnURL, P4-10 reconcile,
// P4-07 daily file, P4-09 cancel job and re-pay). One path for every trigger so they can never
// disagree, always under the collection lock (lib/ecpay/collection-lock.ts), which the cancel
// job and re-pay also hold while they decide (review payments-3: without it a capture could
// land between the cancel job's "unpaid" answer and cancelOrderWorkflow, which re-reads
// nothing; Medusa 2.21.2 maybeUpdatePaymentCollection_ then even turns CANCELED into COMPLETED,
// @medusajs/payment dist/services/payment-module.js:534-588):
//  1. canceled order: a payment captured before the cancel is a duplicate (no-op); otherwise
//     the money arrived after cancellation -> recorded on the order + [ECPAY-ALERT], never
//     captured;
//  2. another trade of the same collection was already captured (re-pay keeps the old trades,
//     so both can be paid): recorded on the order as ecpay_paid_twice + [ECPAY-ALERT] for a
//     manual refund, never captured twice;
//  3. attach the signed proof to the session (the provider's updatePayment re-verifies it:
//     signature, trade number, session id, amount);
//  4. processPaymentWorkflow (authorize -> capture; completes the cart if needed);
//  5. confirm the payment is captured and the cart became an order, else throw (callers
//     retry: ECPay re-sends the notice; the reconcile jobs run again).
// Callers verify the proof's signature and bind it to the session BEFORE calling this.
import type { MedusaContainer } from "@medusajs/framework/types"
import { BigNumber, ContainerRegistrationKeys, MedusaError, PaymentActions } from "@medusajs/framework/utils"
import { processPaymentWorkflow } from "@medusajs/medusa/core-flows"
import { attachEcpayNoticeWorkflow } from "../../workflows/ecpay/attach-ecpay-notice"
import { flagPaidAfterCancelWorkflow } from "../../workflows/ecpay/flag-paid-after-cancel"
import { markOrderMetadataWorkflow } from "../../workflows/ecpay/mark-order-metadata"
import { withCollectionLock } from "./collection-lock"

export type VerifiedPayment = {
  session: { id: string; payment_collection_id: string }
  proofKey: "ecpay_notice" | "ecpay_trade_info"
  proof: Record<string, string>
  merchantTradeNo: string
  tradeNo: string
  amount: number
  paymentDate: string
}

export type RecordOutcome = "captured" | "duplicate_after_cancel" | "paid_after_cancel" | "paid_twice"

// ReturnURL / reconcile wait at most this long; on a timeout ECPay retries and the jobs run
// again (the work is idempotent).
export const RECORD_LOCK_WAIT_SECONDS = 20

export function recordVerifiedPayment(container: MedusaContainer, p: VerifiedPayment, tag: string): Promise<RecordOutcome> {
  return withCollectionLock(container, p.session.payment_collection_id, () => recordVerifiedPaymentHeld(container, p, tag), RECORD_LOCK_WAIT_SECONDS)
}

type CollectionView = {
  order?: { id: string; status: string; metadata?: Record<string, unknown> | null } | null
  payments?: { payment_session_id?: string | null; captured_at?: unknown }[] | null
}

// The caller ALREADY holds withCollectionLock(p.session.payment_collection_id): the cancel job
// and re-pay. Locks are not re-entrant, so they must call this, never recordVerifiedPayment.
export async function recordVerifiedPaymentHeld(container: MedusaContainer, p: VerifiedPayment, tag: string): Promise<RecordOutcome> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: collections } = await query.graph({
    entity: "payment_collection",
    fields: ["id", "order.id", "order.status", "order.metadata", "payments.payment_session_id", "payments.captured_at"],
    filters: { id: p.session.payment_collection_id },
  })
  const pc = collections[0] as CollectionView | undefined
  const order = pc?.order
  const payments = pc?.payments ?? []
  const capturedHere = payments.some((x) => !!x?.captured_at && x.payment_session_id === p.session.id)
  const payment = { merchant_trade_no: p.merchantTradeNo, trade_no: p.tradeNo, amount: p.amount, payment_date: p.paymentDate }

  if (order?.status === "canceled") {
    // Paid and captured before the cancel (the cancel already refunded it through Medusa):
    // a duplicate of a recorded payment, not money received after cancellation.
    if (capturedHere) {
      logger.info(`${tag}: duplicate for a payment captured before order ${order.id} was canceled`)
      return "duplicate_after_cancel"
    }
    await flagPaidAfterCancelWorkflow(container).run({ input: { order_id: order.id, payment } })
    logger.error(`${tag}: [ECPAY-ALERT] paid after order ${order.id} was canceled; refund manually in the ECPay back office`)
    return "paid_after_cancel"
  }

  if (!capturedHere && payments.some((x) => !!x?.captured_at)) {
    if (order) {
      const previous = Array.isArray(order.metadata?.ecpay_paid_twice) ? (order.metadata?.ecpay_paid_twice as { merchant_trade_no?: string }[]) : []
      await markOrderMetadataWorkflow(container).run({
        input: {
          order_id: order.id,
          key: "ecpay_paid_twice",
          value: [...previous.filter((x) => x?.merchant_trade_no !== p.merchantTradeNo), payment],
        },
      })
    }
    logger.error(`${tag}: [ECPAY-ALERT] order ${order?.id ?? "(none)"} was already paid by another ECPay trade; refund NT$${p.amount} manually in the ECPay back office`)
    return "paid_twice"
  }

  await attachEcpayNoticeWorkflow(container).run({
    input: { session_id: p.session.id, notice: p.proof, key: p.proofKey },
  })
  await processPaymentWorkflow(container).run({
    input: { action: PaymentActions.SUCCESSFUL, data: { session_id: p.session.id, amount: new BigNumber(p.amount) } },
  })

  const { data: captured } = await query.graph({
    entity: "payment",
    fields: ["id", "captured_at"],
    filters: { payment_session_id: p.session.id },
  })
  if (!captured.some((r) => r?.captured_at)) {
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
