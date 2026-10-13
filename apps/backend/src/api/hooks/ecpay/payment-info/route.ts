// ECPay PaymentInfoURL (P4-04): an ATM virtual account, CVS payment code or BARCODE was
// issued for an order. This is NOT a payment; the payment arrives later as a ReturnURL
// notice (RtnCode=1) on /hooks/ecpay/payment. Success codes: ATM RtnCode=2, CVS/BARCODE
// RtnCode=10100073 (developers.ecpay.com.tw/2881/). Reply rules are the same as ReturnURL:
// exactly "1|OK", anything else makes ECPay retry.
//
// The route verifies the signature, binds the notice to its payment session, stores the
// payment instructions on the session (the provider re-verifies the notice), and makes
// sure the cart has become an order so the shopper's code belongs to a placed order.
// Storing the code and completing the cart run under the collection lock
// (lib/ecpay/collection-lock.ts; P4-09): re-pay decides on the stored code under the same
// lock, so a code issued for the current trade cannot slip in while re-pay opens a new one.
// A busy collection (20 s) answers non-ACK and ECPay retries.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IPaymentModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { isCodeIssued, parsePaymentInfoNotice } from "../../../../lib/ecpay/aio"
import { withCollectionLock } from "../../../../lib/ecpay/collection-lock"
import { ECPAY_PROVIDER_ID, ecpayOptionsFromEnv } from "../../../../lib/ecpay/config"
import { attachEcpayNoticeWorkflow } from "../../../../workflows/ecpay/attach-ecpay-notice"

const ACK = "1|OK"
const PAYMENT_INFO_LOCK_WAIT_SECONDS = 20

const reply = (res: MedusaResponse, status: number, body: string) =>
  res.status(status).type("text/plain").send(body)

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  let options
  try {
    options = ecpayOptionsFromEnv()
  } catch {
    logger.error("ECPay PaymentInfoURL called but ECPay is not configured")
    return reply(res, 503, "0|Not configured")
  }

  const info = parsePaymentInfoNotice((req.body ?? {}) as Record<string, unknown>, {
    merchantId: options.merchantId,
    hashKey: options.hashKey,
    hashIV: options.hashIV,
  })
  if (!info) {
    logger.warn("ECPay PaymentInfoURL rejected: CheckMacValue or MerchantID mismatch")
    return reply(res, 400, "0|CheckMacValue Error")
  }
  const tag = `ECPay PaymentInfoURL ${info.merchantTradeNo}`

  const paymentModule = req.scope.resolve<IPaymentModuleService>(Modules.PAYMENT)
  const [session] = info.sessionId ? await paymentModule.listPaymentSessions({ id: [info.sessionId] }) : []
  const sessionData = (session?.data ?? {}) as Record<string, unknown>
  if (
    !session ||
    session.provider_id !== ECPAY_PROVIDER_ID ||
    sessionData.merchant_trade_no !== info.merchantTradeNo
  ) {
    logger.error(`${tag}: no matching ECPay payment session (CustomField1=${info.sessionId})`)
    return reply(res, 400, "0|Session mismatch")
  }

  if (!isCodeIssued(info)) {
    logger.info(`${tag}: payment code not issued (RtnCode=${info.rtnCode}, PaymentType=${info.paymentType})`)
    return reply(res, 200, ACK)
  }
  if (info.tradeAmt !== sessionData.amount) {
    logger.error(`${tag}: [ECPAY-ALERT] amount mismatch (code for ${info.tradeAmt}, expected ${String(sessionData.amount)})`)
    return reply(res, 200, ACK)
  }

  try {
    await withCollectionLock(
      req.scope,
      session.payment_collection_id,
      async () => {
        await attachEcpayNoticeWorkflow(req.scope).run({
          input: { session_id: session.id, notice: info.raw, key: "ecpay_payment_info" },
        })

        // The storefront normally completes the cart before redirecting to ECPay. If it did
        // not, complete it now: the shopper is about to pay a code for this order.
        const { data: cartLinks } = await query.graph({
          entity: "cart_payment_collection",
          fields: ["cart_id", "cart.completed_at"],
          filters: { payment_collection_id: session.payment_collection_id },
        })
        const link = cartLinks[0] as { cart_id?: string; cart?: { completed_at?: string | null } } | undefined
        if (link?.cart_id && !link.cart?.completed_at) {
          await completeCartWorkflow(req.scope).run({ input: { id: link.cart_id } })
          const { data: orderLinks } = await query.graph({
            entity: "order_cart",
            fields: ["cart_id"],
            filters: { cart_id: link.cart_id },
          })
          if (!orderLinks.length) {
            throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `cart ${link.cart_id} has no order after code issue`)
          }
        }
      },
      PAYMENT_INFO_LOCK_WAIT_SECONDS
    )
  } catch (e) {
    logger.error(`${tag}: processing failed, ECPay will retry: ${(e as Error).message}`)
    return reply(res, 500, "0|Processing Error")
  }

  logger.info(`${tag}: ${info.paymentType} payment code issued`)
  return reply(res, 200, ACK)
}
