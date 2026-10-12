// Shared steps for ECPay e-invoices (P4-06).
// order.metadata merges only at the top level (Medusa 2.21.2 mergeMetadata), so the record is
// always written as one whole object under `ecpay_invoice`; "" deletes the key.
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { InvoiceRecord } from "../../lib/ecpay/invoice"

export const ECPAY_INVOICE_KEY = "ecpay_invoice"

type SaveInput = { order_id: string; record: InvoiceRecord | null }

export const saveEcpayInvoiceRecordStep = createStep(
  "save-ecpay-invoice-record",
  async (input: SaveInput, { container }) => {
    if (!input.record) {
      return new StepResponse(undefined, null)
    }
    const orderModule = container.resolve(Modules.ORDER)
    const order = await orderModule.retrieveOrder(input.order_id, { select: ["id", "metadata"] })
    const previous = (order.metadata?.[ECPAY_INVOICE_KEY] as InvoiceRecord | undefined) ?? null
    await orderModule.updateOrders([{ id: order.id, metadata: { [ECPAY_INVOICE_KEY]: input.record } }])
    return new StepResponse(undefined, { id: order.id, previous })
  },
  async (prev, { container }) => {
    if (!prev) {
      return
    }
    await container
      .resolve(Modules.ORDER)
      .updateOrders([{ id: prev.id, metadata: { [ECPAY_INVOICE_KEY]: prev.previous ?? "" } }])
  }
)
