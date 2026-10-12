// Records the latest ECPay logistics status on the fulfillment's metadata (P4-05), so staff
// see where a parcel is even for statuses that do not change the order (e.g. arrived at the
// pickup store). Compensation restores the previous metadata.
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"

type Input = {
  fulfillment_id: string
  status: { code: string; message: string; updated_at: string; meaning: string }
}

export const recordLogisticsStatusStep = createStep(
  "record-logistics-status",
  async (input: Input, { container }) => {
    const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
    const current = await fulfillmentModule.retrieveFulfillment(input.fulfillment_id, { select: ["id", "metadata"] })
    const previous = current.metadata ?? null
    const history = Array.isArray(previous?.ecpay_status_history) ? previous.ecpay_status_history : []
    await fulfillmentModule.updateFulfillment(input.fulfillment_id, {
      metadata: {
        ...(previous ?? {}),
        ecpay_status: input.status,
        ecpay_status_history: [...history, input.status].slice(-50),
      },
    })
    return new StepResponse({ id: input.fulfillment_id }, { id: input.fulfillment_id, metadata: previous })
  },
  async (prev, { container }) => {
    if (!prev) {
      return
    }
    await container.resolve(Modules.FULFILLMENT).updateFulfillment(prev.id, { metadata: prev.metadata })
  }
)

export const recordLogisticsStatusWorkflow = createWorkflow(
  "record-logistics-status",
  (input: Input) => new WorkflowResponse(recordLogisticsStatusStep(input))
)
