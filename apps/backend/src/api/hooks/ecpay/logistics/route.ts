// ECPay logistics status notices (ServerReplyURL), P4-05. Signed with MD5 using the logistics
// credentials; must be answered with exactly "1|OK" or ECPay retries (3 times, then daily
// for 3 days). Stage does NOT send these notices, so they are verified with local tests.
//  shipped   -> createOrderShipmentWorkflow (once)
//  delivered -> shipment if missed, then markOrderFulfillmentAsDeliveredWorkflow (once)
//  progress / arrived -> recorded only
//  anything else (store closed, returning, lost, canceled, unknown code) -> recorded +
//  [ECPAY-ALERT] for staff, once per distinct notice
// Canceled fulfillments (or ones whose order link was never made) are recorded and alerted,
// never shipped. Both core workflows throw NOT_ALLOWED when repeated, so state is read first
// and repeats ACK.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IFulfillmentModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createOrderShipmentWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
} from "@medusajs/medusa/core-flows"
import { ECPAY_LOGISTICS_PROVIDER_ID, ecpayLogisticsOptionsFromEnv } from "../../../../lib/ecpay/config"
import { parseLogisticsNotice, statusMeaning, statusNeedsAttention } from "../../../../lib/ecpay/logistics"
import { recordLogisticsStatusWorkflow } from "../../../../workflows/ecpay/record-logistics-status"

const ACK = "1|OK"
const reply = (res: MedusaResponse, status: number, body: string) =>
  res.status(status).type("text/plain").send(body)

type FulfillmentView = {
  id: string
  shipped_at: string | null
  delivered_at: string | null
  canceled_at: string | null
  data: Record<string, unknown> | null
  labels: { tracking_number: string; tracking_url: string; label_url: string }[]
  items: { line_item_id: string | null; quantity: number }[]
  order: { id: string; status: string } | null
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  let options
  try {
    options = ecpayLogisticsOptionsFromEnv()
  } catch {
    logger.error("ECPay logistics notice received but logistics is not configured")
    return reply(res, 503, "0|Not configured")
  }
  const notice = parseLogisticsNotice((req.body ?? {}) as Record<string, unknown>, {
    merchantId: options.merchantId,
    hashKey: options.hashKey,
    hashIV: options.hashIV,
  })
  if (!notice) {
    logger.warn("ECPay logistics notice rejected: CheckMacValue or MerchantID mismatch")
    return reply(res, 400, "0|CheckMacValue Error")
  }
  const tag = `ECPay logistics ${notice.merchantTradeNo} RtnCode=${notice.rtnCode}`

  // Fulfillments store the trade number we sent in Express/Create (fulfillment.data).
  const fulfillmentModule = req.scope.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
  const [hit] = await fulfillmentModule.listFulfillments(
    { provider_id: ECPAY_LOGISTICS_PROVIDER_ID, data: { ecpay_merchant_trade_no: notice.merchantTradeNo } } as never,
    { select: ["id"] }
  )
  if (!hit) {
    logger.error(`${tag}: [ECPAY-ALERT] no fulfillment for this MerchantTradeNo`)
    return reply(res, 400, "0|Unknown shipment")
  }

  const load = async (): Promise<FulfillmentView> => {
    const { data } = await query.graph({
      entity: "fulfillment",
      fields: [
        "id", "shipped_at", "delivered_at", "canceled_at", "data",
        "labels.tracking_number", "labels.tracking_url", "labels.label_url",
        "items.line_item_id", "items.quantity", "order.id", "order.status",
      ],
      filters: { id: hit.id },
    })
    return data[0] as unknown as FulfillmentView
  }

  const meaning = statusMeaning(notice.rtnCode)
  try {
    const f = await load()
    // Every fulfillment we create stores ECPay's shipment id; it must match the signed notice.
    if (!f.data?.ecpay_all_pay_logistics_id || f.data.ecpay_all_pay_logistics_id !== notice.allPayLogisticsId) {
      logger.error(`${tag}: [ECPAY-ALERT] AllPayLogisticsID mismatch for fulfillment ${f.id}`)
      return reply(res, 400, "0|Shipment mismatch")
    }
    const { result: recorded } = await recordLogisticsStatusWorkflow(req.scope).run({
      input: {
        fulfillment_id: f.id,
        status: { code: notice.rtnCode, message: notice.rtnMsg, updated_at: notice.updateStatusDate, meaning },
      },
    })
    const where = f.order ? `order ${f.order.id}` : `fulfillment ${f.id} (no order)`
    if (f.canceled_at || !f.order || f.order.status === "canceled") {
      if (!recorded.duplicate) {
        logger.error(`${tag}: [ECPAY-ALERT] ${meaning} (${notice.rtnMsg}) for canceled ${where}; void it in the ECPay back office`)
      }
      return reply(res, 200, ACK)
    }
    if (statusNeedsAttention(meaning) && !recorded.duplicate) {
      logger.error(`${tag}: [ECPAY-ALERT] ${meaning} (${notice.rtnMsg}) for ${where}`)
    }

    const ship = async (current: FulfillmentView) => {
      if (current.shipped_at) {
        return
      }
      const itemIds = [...new Set(current.items.map((i) => i.line_item_id).filter(Boolean))] as string[]
      await createOrderShipmentWorkflow(req.scope).run({
        input: {
          order_id: current.order!.id,
          fulfillment_id: current.id,
          items: itemIds.map((id) => ({ id, quantity: 1 })),
          // Keep the tracking labels the provider created.
          labels: current.labels.map(({ tracking_number, tracking_url, label_url }) => ({ tracking_number, tracking_url, label_url })),
        },
      })
    }

    if (meaning === "shipped") {
      await ship(f)
    } else if (meaning === "delivered") {
      await ship(f)
      const after = await load()
      if (!after.delivered_at) {
        await markOrderFulfillmentAsDeliveredWorkflow(req.scope).run({
          input: { orderId: f.order.id, fulfillmentId: f.id },
        })
      }
    }
  } catch (e) {
    // A concurrent duplicate may have completed the transition first.
    if (e instanceof MedusaError && e.type === MedusaError.Types.NOT_ALLOWED) {
      const f = await load()
      const done = meaning === "delivered" ? !!f.delivered_at : meaning === "shipped" ? !!f.shipped_at : true
      if (done) {
        return reply(res, 200, ACK)
      }
    }
    logger.error(`${tag}: processing failed, ECPay will retry: ${(e as Error).message}`)
    return reply(res, 500, "0|Processing Error")
  }
  logger.info(`${tag}: ${meaning}`)
  return reply(res, 200, ACK)
}
