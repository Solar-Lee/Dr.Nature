// The order's live ECPay C2C shipments (P4-11 routes).
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ECPAY_LOGISTICS_PROVIDER_ID } from "./config"

export type ShipmentView = {
  id: string
  provider_id: string
  canceled_at?: unknown
  data?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

export async function orderWithShipments(container: MedusaContainer, orderId: string) {
  const { data } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order",
    fields: ["id", "status", "email", "customer_id", "fulfillments.id", "fulfillments.provider_id", "fulfillments.canceled_at", "fulfillments.data", "fulfillments.metadata"],
    filters: { id: orderId },
  })
  const order = data[0] as unknown as
    | { id: string; status: string; email?: string | null; customer_id?: string | null; fulfillments?: ShipmentView[] | null }
    | undefined
  const shipments = (order?.fulfillments ?? []).filter((f) => f.provider_id === ECPAY_LOGISTICS_PROVIDER_ID && !f.canceled_at && f.data?.ecpay_all_pay_logistics_id)
  return { order, shipments }
}
