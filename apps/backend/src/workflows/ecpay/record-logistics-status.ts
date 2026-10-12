// Records ECPay logistics statuses on the fulfillment's metadata (P4-05), so staff see where a
// parcel is even for statuses that do not change the order (e.g. arrived at the pickup store).
// ECPay retries notices for days and does not send them in real time, so:
//  - a repeat (same code + UpdateStatusDate) is not recorded again and is reported as duplicate;
//  - an older status is kept in the history but does not replace the current one.
// Compensation restores the previous metadata.
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"

type Status = { code: string; message: string; updated_at: string; meaning: string }
type Input = { fulfillment_id: string; status: Status }
export type RecordLogisticsStatusResult = { duplicate: boolean; latest: boolean }

// UpdateStatusDate is "yyyy/MM/dd HH:mm:ss" (Taipei), so string order is time order.
const newer = (a: string, b: string) => a > b

export const recordLogisticsStatusStep = createStep(
  "record-logistics-status",
  async (input: Input, { container }) => {
    const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
    const current = await fulfillmentModule.retrieveFulfillment(input.fulfillment_id, { select: ["id", "metadata"] })
    const previous = current.metadata ?? null
    const history: Status[] = Array.isArray(previous?.ecpay_status_history) ? (previous.ecpay_status_history as Status[]) : []
    if (history.some((h) => h?.code === input.status.code && h?.updated_at === input.status.updated_at)) {
      return new StepResponse<RecordLogisticsStatusResult, null>({ duplicate: true, latest: false }, null)
    }
    const shown = previous?.ecpay_status as Status | undefined
    const latest = !shown?.updated_at || !newer(shown.updated_at, input.status.updated_at)
    await fulfillmentModule.updateFulfillment(input.fulfillment_id, {
      metadata: {
        ...(previous ?? {}),
        ecpay_status: latest ? input.status : shown,
        ecpay_status_history: [...history, input.status].slice(-50),
      },
    })
    return new StepResponse<RecordLogisticsStatusResult, { id: string; metadata: Record<string, unknown> | null }>(
      { duplicate: false, latest },
      { id: input.fulfillment_id, metadata: previous }
    )
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
