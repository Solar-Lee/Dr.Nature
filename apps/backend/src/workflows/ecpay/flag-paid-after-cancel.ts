// Records on a canceled order that ECPay reports it paid afterwards, so staff can refund
// it in the ECPay back office (P4-03). The payment is not captured in Medusa, except when an
// admin cancel raced the capture (lib/ecpay/cancel-race.ts): then it is captured, unrefunded.
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"

type Input = {
  order_id: string
  payment: { merchant_trade_no: string; trade_no: string; amount: number; payment_date: string }
}

export const flagPaidAfterCancelStep = createStep(
  "flag-paid-after-cancel",
  async (input: Input, { container }) => {
    const orderModule = container.resolve(Modules.ORDER)
    const order = await orderModule.retrieveOrder(input.order_id, { select: ["id", "metadata"] })
    const previous = order.metadata?.ecpay_paid_after_cancel ?? null
    await orderModule.updateOrders([{ id: order.id, metadata: { ecpay_paid_after_cancel: input.payment } }])
    return new StepResponse({ id: order.id }, { id: order.id, previous })
  },
  // metadata merges at the top level (Medusa 2.21.2 mergeMetadata): restoring an old
  // snapshot would leave the added key behind, so restore the key itself ("" deletes it).
  async (prev, { container }) => {
    if (!prev) {
      return
    }
    await container
      .resolve(Modules.ORDER)
      .updateOrders([{ id: prev.id, metadata: { ecpay_paid_after_cancel: prev.previous ?? "" } }])
  }
)

export const flagPaidAfterCancelWorkflow = createWorkflow(
  "flag-paid-after-cancel",
  (input: Input) => new WorkflowResponse(flagPaidAfterCancelStep(input))
)
