// Attaches a verified ECPay ReturnURL notice to its payment session (P4-03). The payment
// provider's updatePayment re-verifies the notice against the session (signature, trade
// number, session id, amount) before storing it, so a bad notice fails the step.
// No compensation: attaching a verified proof of payment is idempotent and harmless.
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"

type Input = { session_id: string; notice: Record<string, string> }

export const attachEcpayNoticeStep = createStep(
  "attach-ecpay-notice",
  async (input: Input, { container }) => {
    const paymentModule = container.resolve(Modules.PAYMENT)
    const [session] = await paymentModule.listPaymentSessions({ id: [input.session_id] })
    if (!session) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `payment session ${input.session_id} not found`)
    }
    const updated = await paymentModule.updatePaymentSession({
      id: session.id,
      amount: session.amount,
      currency_code: session.currency_code,
      data: { ...(session.data ?? {}), ecpay_notice: input.notice },
    })
    return new StepResponse({ id: updated.id })
  }
)

export const attachEcpayNoticeWorkflow = createWorkflow(
  "attach-ecpay-notice",
  (input: Input) => new WorkflowResponse(attachEcpayNoticeStep(input))
)
