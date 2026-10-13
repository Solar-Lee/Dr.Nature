// [P4-09] Re-pay an unpaid order with a NEW ECPay trade (new MerchantTradeNo; ECPay forbids
// reuse). Called by POST /store/orders/:id/ecpay/repay; tests call it with an explicit `now`.
// Who: the order's logged-in customer, or anyone who knows the order id AND its e-mail (guest
// checkout); wrong e-mails are throttled per order (lib/order-owner.ts).
// Every decision is made UNDER the collection lock on freshly read data (review payments-4 /
// cross-4: two requests that both read the order first would each replace "the" trade):
//  - order pending, one collection, still unpaid, nothing captured, fewer than
//    MAX_ECPAY_TRADES trades, a supported payment method;
//  - the current (newest) trade must be FINAL (lib/ecpay/unpaid.ts tradeFinalAt; review
//    payments-2): before that 409 — the issued code while an ATM / CVS / barcode code can be
//    paid, else retry_after — and ECPay is not asked (this route is public);
//  - once final, ECPay is asked (strict query): paid -> recorded instead (lost notice); ECPay
//    unreachable -> 503, nothing changed; unpaid -> a new trade.
// The old trade is KEPT: paymentModule.createPaymentSession adds a session and leaves the
// others alone (@medusajs/payment dist/services/payment-module.js:147-179), unlike
// createPaymentSessionsWorkflow, which hard-deletes every session of the collection and whose
// compensation re-creates them with NEW trade numbers (@medusajs/core-flows dist/
// payment-collection/workflows/create-payment-session.js:115-126). A late payment on an old
// trade therefore still binds to its session: captured if it is the first payment, otherwise
// flagged ecpay_paid_twice for a manual refund (lib/ecpay/record-payment.ts). The ECPay
// provider ignores the session context (customer / account holder), so nothing is lost by
// not running the workflow.
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { SUPPORTED_CHOOSE_PAYMENT, type ChoosePayment } from "./aio"
import { withCollectionLock } from "./collection-lock"
import { ECPAY_PROVIDER_ID, ecpayOptionsFromEnv } from "./config"
import { recordVerifiedPaymentHeld } from "./record-payment"
import { queryTrade } from "./trade-query"
import { MAX_ECPAY_TRADES, anchorOf, ecpayTradesNewestFirst, liveOfflineCode, tradeFinalAt } from "./unpaid"
import { assertOrderOwnerThrottled } from "../order-owner"

const UNPAID_COLLECTION = ["awaiting", "not_paid"]
// Shoppers retry; a busy collection (a notice or the cancel job working on it) answers 409.
export const REPAY_LOCK_WAIT_SECONDS = 10

export type RepayInput = { orderId: string; actorId?: string; email?: unknown; choosePayment?: unknown }
export type RepayResult = { status: 200 | 409 | 503; body: Record<string, unknown> }

type SessionRow = { id: string; provider_id: string; created_at: string | Date; data?: Record<string, unknown> | null }
type OrderRow = {
  id: string
  status: string
  created_at: string | Date
  email?: string | null
  customer_id?: string | null
  payment_collections?: {
    id: string
    status: string
    amount: number
    currency_code: string
    payments?: { captured_at?: unknown }[] | null
    payment_sessions?: SessionRow[] | null
  }[] | null
}

const notAllowed = () => new MedusaError(MedusaError.Types.NOT_ALLOWED, "此訂單無法重新付款")

export async function repayOrder(container: MedusaContainer, input: RepayInput, opts: { now?: Date } = {}): Promise<RepayResult> {
  const now = opts.now ?? new Date()
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const choosePayment = input.choosePayment === undefined ? "Credit" : input.choosePayment
  if (typeof choosePayment !== "string" || !SUPPORTED_CHOOSE_PAYMENT.includes(choosePayment as ChoosePayment)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "不支援的付款方式")
  }

  // Identity only: every decision below is taken on data re-read under the lock.
  const { data: found } = await query.graph({
    entity: "order",
    fields: ["id", "email", "customer_id", "payment_collections.id"],
    filters: { id: input.orderId },
  })
  const owner = await assertOrderOwnerThrottled(container, input.orderId, found[0] as unknown as OrderRow | undefined, input.actorId, input.email)
  const pcIds = (owner.payment_collections ?? []).map((pc) => pc.id)
  if (pcIds.length !== 1) {
    throw notAllowed()
  }

  try {
    return await withCollectionLock(
      container,
      pcIds[0],
      async (): Promise<RepayResult> => {
        const { data } = await query.graph({
          entity: "order",
          fields: [
            "id", "status", "created_at",
            "payment_collections.id", "payment_collections.status", "payment_collections.amount", "payment_collections.currency_code",
            "payment_collections.payments.captured_at",
            "payment_collections.payment_sessions.id", "payment_collections.payment_sessions.provider_id",
            "payment_collections.payment_sessions.created_at", "payment_collections.payment_sessions.data",
          ],
          filters: { id: owner.id },
        })
        const order = data[0] as unknown as OrderRow | undefined
        const pc = (order?.payment_collections ?? []).find((x) => x.id === pcIds[0])
        if (!order || order.status !== "pending" || !pc || !UNPAID_COLLECTION.includes(pc.status) || (pc.payments ?? []).some((x) => !!x?.captured_at)) {
          throw notAllowed()
        }
        const trades = ecpayTradesNewestFirst(pc.payment_sessions ?? [], ECPAY_PROVIDER_ID)
        if (trades.length >= MAX_ECPAY_TRADES) {
          return { status: 409, body: { message: "重新付款次數已達上限，請聯絡客服" } }
        }
        const current = trades[0]
        if (current) {
          const d = current.data ?? {}
          const finalAt = tradeFinalAt(d, anchorOf(new Date(order.created_at), current))
          if (now < finalAt) {
            return liveOfflineCode(d, now)
              ? { status: 409, body: { message: "請使用原本的繳費代碼或帳號，於期限內繳費", payment_instructions: d.ecpay_payment_instructions } }
              : { status: 409, body: { message: "原付款結果確認中，請稍後再試；若已付款請勿重複付款", retry_after: finalAt.toISOString() } }
          }
          const merchantTradeNo = String(d.merchant_trade_no ?? "")
          const tag = `ECPay re-pay ${merchantTradeNo}`
          const r = await queryTrade(ecpayOptionsFromEnv(), merchantTradeNo)
          if (r.kind === "error") {
            logger.warn(`${tag}: ECPay did not answer (${r.message}); nothing changed`)
            return { status: 503, body: { message: "金流暫時無法確認付款狀態，請稍後再試" } }
          }
          if (r.kind === "paid") {
            if (r.info.tradeAmt !== Number(d.amount)) {
              logger.error(`${tag}: [ECPAY-ALERT] paid NT$${r.info.tradeAmt} but the session expects NT$${String(d.amount)}; re-pay refused`)
              return { status: 409, body: { message: "付款金額與訂單不符，已通知客服處理" } }
            }
            await recordVerifiedPaymentHeld(
              container,
              {
                session: { id: current.id, payment_collection_id: pc.id },
                proofKey: "ecpay_trade_info",
                proof: r.info.raw,
                merchantTradeNo,
                tradeNo: r.info.tradeNo,
                amount: r.info.tradeAmt,
                paymentDate: r.info.raw.PaymentDate ?? "",
              },
              tag
            )
            return { status: 200, body: { already_paid: true } }
          }
        }
        const session = await container.resolve(Modules.PAYMENT).createPaymentSession(pc.id, {
          provider_id: ECPAY_PROVIDER_ID,
          amount: pc.amount,
          currency_code: pc.currency_code,
          data: { choose_payment: choosePayment },
        })
        return { status: 200, body: { payment_session: { id: session.id, data: session.data } } }
      },
      REPAY_LOCK_WAIT_SECONDS
    )
  } catch (e) {
    if ((e as MedusaError).type === MedusaError.Types.CONFLICT) {
      return { status: 409, body: { message: "處理中，請稍後再試" } }
    }
    throw e
  }
}
