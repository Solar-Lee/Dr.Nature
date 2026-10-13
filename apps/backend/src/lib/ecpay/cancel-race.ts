// [P4-09 review, design H2] Admin POST /admin/orders/:id/cancel runs cancelOrderWorkflow without
// the collection lock (lib/ecpay/collection-lock.ts). Its refund step reads the captures once
// (@medusajs/core-flows dist/order/workflows/cancel-order.js:107, refund-captured-payments.js),
// so a capture that commits after that read stays on the canceled order, captured and never
// refunded, with the stock already released. Two checks cover both commit orders:
//  - recordVerifiedPaymentHeld re-reads the order after capturing (the cancel committed first);
//  - the order.canceled subscriber (subscribers/ecpay-cancel-race.ts) runs after the cancel
//    workflow finished (the capture committed first).
// Either one flags the order (ecpay_paid_after_cancel) and raises [ECPAY-ALERT]; both can fire
// for the same payment, which only repeats the alert. A capture the cancel DID refund has a
// refund row (the provider records it, manual_pending or done, P4-08) and is not reported.
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { flagPaidAfterCancelWorkflow } from "../../workflows/ecpay/flag-paid-after-cancel"
import { ECPAY_PROVIDER_ID } from "./config"

export type OpenCapture = {
  payment_id: string
  payment_session_id: string | null
  unrefunded: number
  merchant_trade_no: string
  trade_no: string
  payment_date: string
}

type PaymentView = {
  id: string
  provider_id: string
  payment_session_id?: string | null
  data?: Record<string, unknown> | null
  captures?: { amount?: unknown }[] | null
  refunds?: { amount?: unknown }[] | null
}

const sum = (rows: { amount?: unknown }[] | null | undefined) => (rows ?? []).reduce((acc, r) => acc + Number(r?.amount ?? 0), 0)

// ECPay payments of a canceled order holding more captured than refunded.
export async function openCapturesOnCanceledOrder(container: MedusaContainer, orderId: string): Promise<OpenCapture[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "status", "payment_collections.id"],
    filters: { id: orderId },
  })
  const order = orders[0] as { status?: string; payment_collections?: { id: string }[] | null } | undefined
  const collectionIds = (order?.payment_collections ?? []).map((pc) => pc.id)
  if (order?.status !== "canceled" || !collectionIds.length) {
    return []
  }
  const { data } = await query.graph({
    entity: "payment",
    fields: ["id", "provider_id", "payment_session_id", "data", "captures.amount", "refunds.amount"],
    filters: { payment_collection_id: collectionIds },
  })
  return (data as unknown as PaymentView[])
    .filter((p) => p.provider_id === ECPAY_PROVIDER_ID)
    .map((p) => {
      const d = p.data ?? {}
      const proof = (d.ecpay_notice ?? d.ecpay_trade_info ?? {}) as Record<string, unknown>
      return {
        payment_id: p.id,
        payment_session_id: p.payment_session_id ?? null,
        unrefunded: sum(p.captures) - sum(p.refunds),
        merchant_trade_no: String(d.merchant_trade_no ?? ""),
        trade_no: String(d.ecpay_trade_no ?? proof.TradeNo ?? ""),
        payment_date: String(proof.PaymentDate ?? ""),
      }
    })
    .filter((c) => c.unrefunded > 0)
}

export async function flagOpenCaptures(container: MedusaContainer, orderId: string, open: OpenCapture[], tag: string): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  for (const c of open) {
    await flagPaidAfterCancelWorkflow(container).run({
      input: { order_id: orderId, payment: { merchant_trade_no: c.merchant_trade_no, trade_no: c.trade_no, amount: c.unrefunded, payment_date: c.payment_date } },
    })
    logger.error(
      `${tag}: [ECPAY-ALERT] order ${orderId} was canceled while ECPay trade ${c.merchant_trade_no} (TradeNo ${c.trade_no}) was being captured: NT$${c.unrefunded} captured and not refunded; refund manually in the ECPay back office`
    )
  }
}
