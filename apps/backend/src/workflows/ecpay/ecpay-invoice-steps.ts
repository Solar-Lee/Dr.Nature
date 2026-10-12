// Shared steps for ECPay e-invoices (P4-06).
// order.metadata merges only at the top level (Medusa 2.21.2 mergeMetadata), so each key is
// always written as one whole object; "" deletes a key. Compensation restores each key.
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"

export const ECPAY_INVOICE_KEY = "ecpay_invoice"
export const ECPAY_INVOICE_CHOICE_KEY = "ecpay_invoice_choice"

type SaveInput = { order_id: string; values: Record<string, unknown> | null }

export const saveEcpayInvoiceRecordStep = createStep(
  "save-ecpay-invoice-record",
  async (input: SaveInput, { container }) => {
    if (!input.values) {
      return new StepResponse(undefined, null)
    }
    const orderModule = container.resolve(Modules.ORDER)
    const order = await orderModule.retrieveOrder(input.order_id, { select: ["id", "metadata"] })
    const previous = Object.fromEntries(Object.keys(input.values).map((k) => [k, order.metadata?.[k] ?? ""]))
    await orderModule.updateOrders([{ id: order.id, metadata: input.values }])
    return new StepResponse(undefined, { id: order.id, previous })
  },
  async (prev, { container }) => {
    if (!prev) {
      return
    }
    await container.resolve(Modules.ORDER).updateOrders([{ id: prev.id, metadata: prev.previous }])
  }
)
