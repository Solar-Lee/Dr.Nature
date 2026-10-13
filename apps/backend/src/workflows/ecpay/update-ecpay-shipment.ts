// Records a C2C store change on an ECPay shipment (P4-11): after ECPay accepted it
// (UpdateStoreInfo "1|OK") fulfillment.data.store (pickup store) and a history entry in
// metadata.ecpay_store_updates; when ECPay's answer was lost (unconfirmed) only the history entry,
// so staff can check it in the ECPay back office. for_status ties a pickup-store change to the
// closure notice it answers (one reselect per notice). Compensation restores both.
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"

type Input = {
  fulfillment_id: string
  store?: Record<string, unknown> // new pickup store (StoreType 01)
  update: { at: string; store_type: "01" | "02"; store_id: string; by: string; for_status?: string; unconfirmed?: boolean }
}

export const updateEcpayShipmentStep = createStep(
  "update-ecpay-shipment",
  async (input: Input, { container }) => {
    const fm = container.resolve(Modules.FULFILLMENT)
    const f = await fm.retrieveFulfillment(input.fulfillment_id, { select: ["id", "data", "metadata"] })
    const history = Array.isArray(f.metadata?.ecpay_store_updates) ? (f.metadata!.ecpay_store_updates as unknown[]) : []
    await fm.updateFulfillment(f.id, {
      ...(input.store ? { data: { ...(f.data ?? {}), store: input.store } } : {}),
      metadata: { ecpay_store_updates: [...history, input.update] },
    } as never)
    return new StepResponse(undefined, { id: f.id, data: f.data ?? {}, history })
  },
  async (prev, { container }) => {
    if (!prev) return
    await container.resolve(Modules.FULFILLMENT).updateFulfillment(prev.id, {
      data: prev.data,
      metadata: { ecpay_store_updates: prev.history.length ? prev.history : "" },
    } as never)
  }
)

export const updateEcpayShipmentWorkflow = createWorkflow(
  "update-ecpay-shipment",
  (input: Input) => new WorkflowResponse(updateEcpayShipmentStep(input))
)
