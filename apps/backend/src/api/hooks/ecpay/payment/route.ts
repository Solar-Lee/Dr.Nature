// ECPay ReturnURL (server-to-server payment notice), P4-03.
//
// ECPay requires the exact plain-text body "1|OK"; anything else makes it retry after
// 5-15 minutes, up to 4 times a day (developers.ecpay.com.tw/2878/). Medusa's built-in
// /hooks/payment/:provider route answers "OK" and processes later, so this route:
//  1. verifies CheckMacValue and the merchant (never processes an unsigned body),
//  2. binds the notice to its payment session (CustomField1 + MerchantTradeNo),
//  3. acknowledges failed / simulated / mismatched notices without changing state,
//  4-5. hands the verified notice to recordVerifiedPayment (lib/ecpay/record-payment.ts,
//     shared with the P4-10 reconcile job): never captures onto a canceled order (records
//     and alerts instead); otherwise attaches the notice as proof (the provider re-verifies
//     it; no QueryTradeInfo round-trip), runs processPaymentWorkflow, and replies "1|OK"
//     only once the payment is captured and the cart has become an order; else ECPay retries.
//     It runs under the payment collection's lock (P4-09), shared with the unpaid-cancel job
//     and re-pay; a collection busy for 20 s answers non-ACK and ECPay retries. A paid notice
//     for an older trade of a re-paid order is captured if it is the first payment, otherwise
//     recorded as ecpay_paid_twice for a manual refund (both answer "1|OK").
// Log lines tagged [ECPAY-ALERT] need a human (monitoring hooks them up, P11/P12).
// /hooks/* has no publishable-key, auth or CORS middleware in Medusa 2.21.2.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IPaymentModuleService } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  PaymentActions,
} from "@medusajs/framework/utils"
import { parsePaymentNotice } from "../../../../lib/ecpay/aio"
import { ECPAY_PROVIDER_ID, ecpayOptionsFromEnv } from "../../../../lib/ecpay/config"
import { recordVerifiedPayment } from "../../../../lib/ecpay/record-payment"

const ACK = "1|OK"

const reply = (res: MedusaResponse, status: number, body: string) =>
  res.status(status).type("text/plain").send(body)

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  let options
  try {
    options = ecpayOptionsFromEnv()
  } catch {
    logger.error("ECPay ReturnURL called but ECPay is not configured")
    return reply(res, 503, "0|Not configured")
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const notice = parsePaymentNotice(body, {
    merchantId: options.merchantId,
    hashKey: options.hashKey,
    hashIV: options.hashIV,
  })
  if (!notice) {
    logger.warn("ECPay ReturnURL rejected: CheckMacValue or MerchantID mismatch")
    return reply(res, 400, "0|CheckMacValue Error")
  }
  const tag = `ECPay ReturnURL ${notice.merchantTradeNo}`

  const paymentModule = req.scope.resolve<IPaymentModuleService>(Modules.PAYMENT)
  const [session] = notice.sessionId
    ? await paymentModule.listPaymentSessions({ id: [notice.sessionId] })
    : []
  const sessionData = (session?.data ?? {}) as Record<string, unknown>
  if (
    !session ||
    session.provider_id !== ECPAY_PROVIDER_ID ||
    sessionData.merchant_trade_no !== notice.merchantTradeNo
  ) {
    // Signed by ECPay but not attached to a live session (e.g. the session was replaced before
    // checkout; once the order exists, re-pay keeps old sessions).
    // Keep answering non-ACK so ECPay retries and the alert repeats until handled.
    const level = notice.rtnCode === "1" && !notice.simulatePaid ? "[ECPAY-ALERT] paid notice" : "notice"
    logger.error(`${tag}: ${level} without a matching ECPay payment session (CustomField1=${notice.sessionId})`)
    return reply(res, 400, "0|Session mismatch")
  }

  if (notice.simulatePaid && !options.acceptSimulatedPayments) {
    logger.warn(`${tag}: SimulatePaid=1 (vendor back-office simulation), ignored`)
    return reply(res, 200, ACK)
  }
  if (notice.rtnCode !== "1") {
    logger.info(`${tag}: payment not successful (RtnCode=${notice.rtnCode})`)
    return reply(res, 200, ACK)
  }
  if (notice.tradeAmt !== sessionData.amount) {
    // Signed by ECPay but for a different amount: never capture; needs manual review.
    logger.error(`${tag}: [ECPAY-ALERT] amount mismatch (paid ${notice.tradeAmt}, expected ${String(sessionData.amount)})`)
    return reply(res, 200, ACK)
  }

  try {
    // Defense in depth: the provider re-verifies the notice itself.
    const event = await paymentModule.getWebhookActionAndData({
      provider: "ecpay_ecpay",
      payload: { data: body, rawData: "", headers: req.headers as Record<string, unknown> },
    })
    if (event.action !== PaymentActions.SUCCESSFUL || event.data?.session_id !== session.id) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `unexpected webhook action ${event.action}`)
    }
    const outcome = await recordVerifiedPayment(
      req.scope,
      {
        session: { id: session.id, payment_collection_id: session.payment_collection_id },
        proofKey: "ecpay_notice",
        proof: notice.raw,
        merchantTradeNo: notice.merchantTradeNo,
        tradeNo: notice.tradeNo,
        amount: notice.tradeAmt,
        paymentDate: notice.paymentDate,
      },
      tag
    )
    if (outcome !== "captured") {
      return reply(res, 200, ACK)
    }
  } catch (e) {
    logger.error(`${tag}: processing failed, ECPay will retry: ${(e as Error).message}`)
    return reply(res, 500, "0|Processing Error")
  }

  logger.info(`${tag}: payment captured`)
  return reply(res, 200, ACK)
}
