// Writes one top-level key of order.metadata (whole value; Medusa 2.21.2 merges metadata at
// the top level only). Compensation restores that key ("" deletes it). Used for system
// records such as ecpay_auto_canceled (P4-09).
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"

type Input = { order_id: string; key: string; value: unknown }

export const markOrderMetadataStep = createStep(
  "mark-order-metadata",
  async (input: Input, { container }) => {
    const orderModule = container.resolve(Modules.ORDER)
    const order = await orderModule.retrieveOrder(input.order_id, { select: ["id", "metadata"] })
    const previous = order.metadata?.[input.key] ?? ""
    await orderModule.updateOrders([{ id: order.id, metadata: { [input.key]: input.value } }])
    return new StepResponse(undefined, { id: order.id, key: input.key, previous })
  },
  async (prev, { container }) => {
    if (!prev) return
    await container.resolve(Modules.ORDER).updateOrders([{ id: prev.id, metadata: { [prev.key]: prev.previous } }])
  }
)

export const markOrderMetadataWorkflow = createWorkflow(
  "mark-order-metadata",
  (input: Input) => new WorkflowResponse(markOrderMetadataStep(input))
)
