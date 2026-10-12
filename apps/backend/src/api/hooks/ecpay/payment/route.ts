// ECPay ReturnURL (server-to-server payment notice), P4-03.
//
// ECPay requires the exact plain-text body "1|OK"; anything else makes it retry after
// 5-15 minutes, up to 4 times a day (developers.ecpay.com.tw/2878/). Medusa's built-in
// /hooks/payment/:provider route answers "OK" and processes later, so this route:
//  1. verifies CheckMacValue and the merchant (never processes an unsigned body),
//  2. binds the notice to its payment session (CustomField1 + MerchantTradeNo),
//  3. acknowledges failed / simulated / mismatched notices without changing state,
//  4. never captures onto a canceled order: records the payment on the order and alerts,
//  5. attaches the verified notice to its session (the provider re-verifies it; this signed
//     notice is the proof of payment, no QueryTradeInfo round-trip), runs
//     processPaymentWorkflow, and replies "1|OK" only once the payment is captured and the
//     cart has become an order; otherwise ECPay retries.
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
import { processPaymentWorkflow } from "@medusajs/medusa/core-flows"
import { parsePaymentNotice } from "../../../../lib/ecpay/aio"
import { ECPAY_PROVIDER_ID, ecpayOptionsFromEnv } from "../../../../lib/ecpay/config"
import { attachEcpayNoticeWorkflow } from "../../../../workflows/ecpay/attach-ecpay-notice"
import { flagPaidAfterCancelWorkflow } from "../../../../workflows/ecpay/flag-paid-after-cancel"

const ACK = "1|OK"

const reply = (res: MedusaResponse, status: number, body: string) =>
  res.status(status).type("text/plain").send(body)

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

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
    // Signed by ECPay but not attached to a live session (e.g. the session was replaced).
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

  // Order (if the cart was already completed) for this payment collection.
  const { data: collections } = await query.graph({
    entity: "payment_collection",
    fields: ["id", "order.id", "order.status", "order.metadata"],
    filters: { id: session.payment_collection_id },
  })
  const order = (collections[0] as any)?.order as
    | { id: string; status: string; metadata?: Record<string, unknown> | null }
    | undefined
  if (order?.status === "canceled") {
    // Paid and captured before the cancel (the cancel already refunded it through Medusa):
    // this is a duplicate of a recorded payment, not money received after cancellation.
    const { data: recorded } = await query.graph({
      entity: "payment",
      fields: ["id", "captured_at"],
      filters: { payment_session_id: session.id },
    })
    if (recorded.some((p) => p?.captured_at)) {
      logger.info(`${tag}: duplicate notice for a payment captured before order ${order.id} was canceled`)
      return reply(res, 200, ACK)
    }
    await flagPaidAfterCancelWorkflow(req.scope).run({
      input: {
        order_id: order.id,
        payment: {
          merchant_trade_no: notice.merchantTradeNo,
          trade_no: notice.tradeNo,
          amount: notice.tradeAmt,
          payment_date: notice.paymentDate,
        },
      },
    })
    logger.error(`${tag}: [ECPAY-ALERT] paid after order ${order.id} was canceled; refund manually in the ECPay back office`)
    return reply(res, 200, ACK)
  }

  try {
    // The provider's updatePayment re-verifies the notice against this session before
    // storing it; authorizePayment then accepts it as proof of payment.
    await attachEcpayNoticeWorkflow(req.scope).run({
      input: { session_id: session.id, notice: notice.raw },
    })
    const event = await paymentModule.getWebhookActionAndData({
      provider: "ecpay_ecpay",
      payload: { data: body, rawData: "", headers: req.headers as Record<string, unknown> },
    })
    if (event.action !== PaymentActions.SUCCESSFUL || event.data?.session_id !== session.id) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `unexpected webhook action ${event.action}`)
    }
    await processPaymentWorkflow(req.scope).run({ input: event })

    const { data: payments } = await query.graph({
      entity: "payment",
      fields: ["id", "captured_at"],
      filters: { payment_session_id: session.id },
    })
    if (!payments.some((p) => p?.captured_at)) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "payment not captured after processing")
    }
    const { data: cartLinks } = await query.graph({
      entity: "cart_payment_collection",
      fields: ["cart_id"],
      filters: { payment_collection_id: session.payment_collection_id },
    })
    const cartId = cartLinks[0]?.cart_id
    if (cartId) {
      const { data: orderLinks } = await query.graph({
        entity: "order_cart",
        fields: ["cart_id"],
        filters: { cart_id: cartId },
      })
      if (!orderLinks.length) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `cart ${cartId} has no order after payment`)
      }
    }
  } catch (e) {
    logger.error(`${tag}: processing failed, ECPay will retry: ${(e as Error).message}`)
    return reply(res, 500, "0|Processing Error")
  }

  logger.info(`${tag}: payment captured`)
  return reply(res, 200, ACK)
}
