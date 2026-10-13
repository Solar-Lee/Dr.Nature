// [P4-09] Re-pay an unpaid order: a NEW ECPay trade (new MerchantTradeNo; ECPay forbids reuse)
// on the order's payment collection.
// Who: the order's logged-in customer, or anyone who knows the order id AND its e-mail
// (guest checkout; the order id alone already opens GET /store/orders/:id in Medusa).
// Safety (fail closed, docs/research/p4-p5-2026-10-13.md §3):
//  - per-order lock; only status "pending" orders whose collection is still unpaid;
//  - an issued ATM / CVS / barcode code that can still be paid -> refused (pay that code;
//    otherwise the shopper could pay twice);
//  - the previous trade is asked first: paid -> recorded instead (lost notice); ECPay
//    unreachable -> 503, nothing changed (the workflow would delete the old session).
// The old ECPay form stays payable at ECPay: a late payment on it arrives without a session
// and raises [ECPAY-ALERT] (ReturnURL route) and in the daily reconciliation (P4-07).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createPaymentSessionsWorkflow } from "@medusajs/medusa/core-flows"
import { ECPAY_PROVIDER_ID, ecpayOptionsFromEnv } from "../../../../../../lib/ecpay/config"
import { recordVerifiedPayment } from "../../../../../../lib/ecpay/record-payment"
import { queryTrade } from "../../../../../../lib/ecpay/trade-query"
import { liveOfflineCode } from "../../../../../../lib/ecpay/unpaid"
import { assertOrderOwnerThrottled } from "../../../../../../lib/order-owner"

const UNPAID_COLLECTION = ["awaiting", "not_paid"]

type OrderView = {
  id: string
  status: string
  email?: string | null
  customer_id?: string | null
  payment_collections?: {
    id: string
    status: string
    payments?: { captured_at?: unknown }[] | null
    payment_sessions?: { id: string; provider_id: string; created_at: string | Date; data?: Record<string, unknown> | null }[] | null
  }[] | null
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as { email?: unknown; choose_payment?: unknown }
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id", "status", "email", "customer_id",
      "payment_collections.id", "payment_collections.status", "payment_collections.payments.captured_at",
      "payment_collections.payment_sessions.id", "payment_collections.payment_sessions.provider_id",
      "payment_collections.payment_sessions.created_at", "payment_collections.payment_sessions.data",
    ],
    filters: { id: req.params.id },
  })
  const order = data[0] as unknown as OrderView | undefined
  const actor = req.auth_context?.actor_id
  const owned = await assertOrderOwnerThrottled(req.scope, req.params.id, order, actor, body.email)
  const pc = (owned.payment_collections ?? [])[0]
  if (owned.status !== "pending" || !pc || !UNPAID_COLLECTION.includes(pc.status) || (pc.payments ?? []).some((p) => !!p.captured_at)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "此訂單無法重新付款")
  }
  const choosePayment = typeof body.choose_payment === "string" ? body.choose_payment : "Credit"
  const options = ecpayOptionsFromEnv()

  const result = await req.scope.resolve(Modules.LOCKING).execute(
    `drn-repay:${owned.id}`,
    async () => {
      const current = (pc.payment_sessions ?? [])
        .filter((s) => s.provider_id === ECPAY_PROVIDER_ID)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      if (current) {
        const d = current.data ?? {}
        if (liveOfflineCode(d, new Date())) {
          return { status: 409, body: { message: "請使用原本的繳費代碼或帳號，於期限內繳費", payment_instructions: d.ecpay_payment_instructions } }
        }
        const merchantTradeNo = String(d.merchant_trade_no ?? "")
        const r = await queryTrade(options, merchantTradeNo)
        if (r.kind === "error") {
          return { status: 503, body: { message: "金流暫時無法確認付款狀態，請稍後再試" } }
        }
        if (r.kind === "paid") {
          if (r.info.tradeAmt !== Number(d.amount)) {
            return { status: 409, body: { message: "付款金額與訂單不符，已通知客服處理" } }
          }
          await recordVerifiedPayment(
            req.scope,
            {
              session: { id: current.id, payment_collection_id: pc.id },
              proofKey: "ecpay_trade_info",
              proof: r.info.raw,
              merchantTradeNo,
              tradeNo: r.info.tradeNo,
              amount: r.info.tradeAmt,
              paymentDate: r.info.raw.PaymentDate ?? "",
            },
            `ECPay re-pay ${merchantTradeNo}`
          )
          return { status: 200, body: { already_paid: true } }
        }
      }
      const { result: session } = await createPaymentSessionsWorkflow(req.scope).run({
        input: {
          payment_collection_id: pc.id,
          provider_id: ECPAY_PROVIDER_ID,
          ...(actor && actor === owned.customer_id ? { customer_id: actor } : {}),
          data: { choose_payment: choosePayment },
        },
      })
      return { status: 200, body: { payment_session: { id: session.id, data: session.data } } }
    },
    { timeout: 10 }
  )
  res.status(result.status).json(result.body)
}
