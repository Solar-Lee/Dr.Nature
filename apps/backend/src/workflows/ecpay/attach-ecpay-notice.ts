// Attaches a verified ECPay notice to its payment session: the ReturnURL payment notice
// (P4-03, key ecpay_notice) or the PaymentInfoURL code-issued notice (P4-04, key
// ecpay_payment_info). The provider's updatePayment re-verifies it against the session
// (signature, trade number, session id, amount) before storing it, so a bad notice fails.
// No compensation: attaching a verified, signed ECPay notice is idempotent and harmless.
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"

type Input = {
  session_id: string
  notice: Record<string, string>
  key?: "ecpay_notice" | "ecpay_payment_info"
}

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
      data: { ...(session.data ?? {}), [input.key ?? "ecpay_notice"]: input.notice },
    })
    return new StepResponse({ id: updated.id })
  }
)

export const attachEcpayNoticeWorkflow = createWorkflow(
  "attach-ecpay-notice",
  (input: Input) => new WorkflowResponse(attachEcpayNoticeStep(input))
)
