// [P4-05] ECPay logistics shipping options for the Taiwan service zone.
//   7-ELEVEN / 全家 / 萊爾富 超商取貨 (C2C 店到店 by default) and 宅配（黑貓）.
// Every option costs NT$0 (全館免運, Aki 2026-10-13). Home delivery is created but NOT enabled
// in the store until the ECPay contract confirms C2C merchants may use TCAT.
// Fails, and stays pending, if the ecpay_logistics provider is not registered.
import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { ECPAY_LOGISTICS_PROVIDER_ID, ecpayLogisticsOptionsFromEnv } from "../lib/ecpay/config"
import { FULFILLMENT_SET_NAME, STOCK_LOCATION_NAME } from "../lib/drn-setup"
import { fulfillmentOptionsFor } from "../modules/ecpay-logistics/service"

const SHIPPING_FEE_TWD = 0
const ENABLED_IN_STORE: Record<string, boolean> = {
  "cvs-unimart": true,
  "cvs-fami": true,
  "cvs-hilife": true,
  "home-tcat": false,
}

export default async function drnEcpayLogisticsShipping({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)

  const providers = await fulfillmentModule.listFulfillmentProviders({ id: [ECPAY_LOGISTICS_PROVIDER_ID] })
  if (!providers.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `[drn-0006] fulfillment provider ${ECPAY_LOGISTICS_PROVIDER_ID} is not registered; set ECPAY_LOGISTICS_* (docs/ENV.md)`
    )
  }
  const [location] = await container.resolve(Modules.STOCK_LOCATION).listStockLocations({ name: STOCK_LOCATION_NAME })
  const [fulfillmentSet] = await fulfillmentModule.listFulfillmentSets(
    { name: FULFILLMENT_SET_NAME },
    { relations: ["service_zones"] }
  )
  const [profile] = await fulfillmentModule.listShippingProfiles({ type: "default" })
  if (!location || !fulfillmentSet?.service_zones?.length || !profile) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "[drn-0006] warehouse, Taiwan service zone or shipping profile missing")
  }

  // A shipping option can use a provider only if the provider is linked to the warehouse.
  const {
    data: [locationLinks],
  } = await query.graph({
    entity: "stock_location",
    fields: ["id", "fulfillment_providers.id"],
    filters: { id: location.id },
  })
  const linked = (locationLinks?.fulfillment_providers ?? []).map((p) => p?.id)
  if (!linked.includes(ECPAY_LOGISTICS_PROVIDER_ID)) {
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: ECPAY_LOGISTICS_PROVIDER_ID },
    })
  }

  const contract = ecpayLogisticsOptionsFromEnv().contract
  const options = fulfillmentOptionsFor(contract)
  const existing = await fulfillmentModule.listShippingOptions({ name: options.map((o) => o.name) })
  const existingNames = new Set(existing.map((o) => o.name))
  const toCreate = options.filter((o) => !existingNames.has(o.name))
  if (toCreate.length) {
    await createShippingOptionsWorkflow(container).run({
      input: toCreate.map((o) => ({
        name: o.name,
        price_type: "flat" as const,
        provider_id: ECPAY_LOGISTICS_PROVIDER_ID,
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: profile.id,
        type: { label: o.name, description: o.logistics_type === "CVS" ? "超商取貨" : "宅配到府", code: o.id },
        data: { id: o.id, logistics_type: o.logistics_type, logistics_subtype: o.logistics_subtype },
        prices: [{ currency_code: "twd", amount: SHIPPING_FEE_TWD }],
        rules: [
          { attribute: "enabled_in_store", value: ENABLED_IN_STORE[o.id] ? "true" : "false", operator: "eq" as const },
          { attribute: "is_return", value: "false", operator: "eq" as const },
        ],
      })),
    })
    logger.info(`[drn-0006] created shipping options (${contract}): ${toCreate.map((o) => o.name).join(", ")}`)
  }
}
