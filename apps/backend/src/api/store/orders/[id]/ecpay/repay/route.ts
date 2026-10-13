// [P4-09] Re-pay an unpaid order with a NEW ECPay trade. Rules, locking and why the old trade is
// kept: lib/ecpay/repay.ts. Answers:
//  200 { payment_session: { id, data } }  new trade (data.checkout_form is the signed form)
//  200 { already_paid: true }             the current trade was paid (lost notice); recorded
//  409 { payment_instructions }           an issued ATM / CVS / barcode code can still be paid
//  409 { retry_after }                    the current trade may still turn paid; retry later
//  409                                    too many trades, amount mismatch, or busy
//  503                                    ECPay did not answer; nothing changed
//  400 / 404                              not re-payable / not found (or not the owner)
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { repayOrder } from "../../../../../../lib/ecpay/repay"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as { email?: unknown; choose_payment?: unknown }
  const result = await repayOrder(req.scope, {
    orderId: req.params.id,
    actorId: req.auth_context?.actor_id,
    email: body.email,
    choosePayment: body.choose_payment,
  })
  res.status(result.status).json(result.body)
}
