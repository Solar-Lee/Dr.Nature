// [P3-03] Taiwan store: TWD tax-inclusive pricing, Taiwan region, 5% tax region,
// warehouse with a Taiwan service zone, and the Official Store sales channel as default.
//
// Runs once per database during `medusa db:migrate` (tracked in script_migrations by
// file basename). Every step looks its record up first, so a retry after a partial
// failure creates nothing twice. Never rename this file after it has run anywhere.
//
// Verified against @medusajs/* 2.21.2 source (see docs/research/medusa-p3.md):
// - plain TWD prices follow the *currency* price preference, which the store's
//   supported_currencies[].is_tax_inclusive sets; the region preference is set too so
//   region-scoped prices behave the same way.
// - createTaxRegionsWorkflow takes a plain array; the tax rate `code` is NOT NULL.
import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  CURRENCY_CODE,
  FULFILLMENT_SET_NAME,
  REGION_COUNTRIES,
  REGION_NAME,
  SALES_CHANNELS,
  SERVICE_ZONE_NAME,
  STOCK_LOCATION_NAME,
  STORE_NAME,
  TAX_RATE,
} from "../lib/drn-setup"

export default async function drnTwStoreRegionTax({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const storeModule = container.resolve(Modules.STORE)
  const regionModule = container.resolve(Modules.REGION)
  const taxModule = container.resolve(Modules.TAX)
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)

  // 1. Official Store sales channel (becomes the store default).
  let [official] = await salesChannelModule.listSalesChannels({
    name: SALES_CHANNELS.official.name,
  })
  if (!official) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ ...SALES_CHANNELS.official }] },
    })
    official = result[0]
    logger.info(`[drn-0001] created sales channel ${official.name}`)
  }

  // 2. Store: TWD only, tax-inclusive.
  const supportedCurrencies = [
    { currency_code: CURRENCY_CODE, is_default: true, is_tax_inclusive: true },
  ]
  const [store] = await storeModule.listStores({}, { take: 1 })
  let storeId: string
  if (!store) {
    const { result } = await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: STORE_NAME,
            supported_currencies: supportedCurrencies,
            default_sales_channel_id: official.id,
          },
        ],
      },
    })
    storeId = result[0].id
    logger.info("[drn-0001] created store")
  } else {
    storeId = store.id
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: storeId },
        update: {
          name: STORE_NAME,
          supported_currencies: supportedCurrencies,
          default_sales_channel_id: official.id,
        },
      },
    })
    logger.info("[drn-0001] updated existing store to TWD tax-inclusive")
  }

  // 3. Taiwan region.
  let [region] = await regionModule.listRegions({ name: REGION_NAME })
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: REGION_NAME,
            currency_code: CURRENCY_CODE,
            countries: REGION_COUNTRIES,
            automatic_taxes: true,
            is_tax_inclusive: true,
            // Replaced by the ECPay provider in P4-03.
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    })
    region = result[0]
    logger.info(`[drn-0001] created region ${region.name}`)
  }

  // 4. Tax region TW at 5%.
  const taxRegions = await taxModule.listTaxRegions({
    country_code: REGION_COUNTRIES[0],
  })
  if (!taxRegions.some((tr) => !tr.parent_id)) {
    await createTaxRegionsWorkflow(container).run({
      input: [
        {
          country_code: REGION_COUNTRIES[0],
          provider_id: "tp_system",
          default_tax_rate: { ...TAX_RATE },
        },
      ],
    })
    logger.info("[drn-0001] created tax region tw (5%)")
  }

  // 5. Warehouse, linked to the Official Store channel.
  let [location] = await stockLocationModule.listStockLocations({
    name: STOCK_LOCATION_NAME,
  })
  if (!location) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: STOCK_LOCATION_NAME,
            address: { country_code: "TW", address_1: "" },
          },
        ],
      },
    })
    location = result[0]
    logger.info("[drn-0001] created stock location")
  }
  const {
    data: [locationLinks],
  } = await query.graph({
    entity: "stock_location",
    fields: ["id", "sales_channels.id", "fulfillment_sets.id"],
    filters: { id: location.id },
  })
  const linkedChannelIds = (locationLinks?.sales_channels ?? []).map((sc) => sc?.id)
  if (!linkedChannelIds.includes(official.id)) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: location.id, add: [official.id] },
    })
  }

  // 6. Fulfillment set with a Taiwan service zone, linked to the warehouse.
  //    Shipping options (ECPay CVS pickup / home delivery) are added in P4-05.
  let [fulfillmentSet] = await fulfillmentModule.listFulfillmentSets(
    { name: FULFILLMENT_SET_NAME },
    { relations: ["service_zones"] }
  )
  if (!fulfillmentSet) {
    fulfillmentSet = await fulfillmentModule.createFulfillmentSets({
      name: FULFILLMENT_SET_NAME,
      type: "shipping",
      service_zones: [
        {
          name: SERVICE_ZONE_NAME,
          geo_zones: [{ type: "country", country_code: REGION_COUNTRIES[0] }],
        },
      ],
    })
    logger.info("[drn-0001] created fulfillment set + Taiwan service zone")
  }
  const linkedSetIds = (locationLinks?.fulfillment_sets ?? []).map((fs) => fs?.id)
  if (!linkedSetIds.includes(fulfillmentSet.id)) {
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
    })
  }

  // 7. Default shipping profile (products require one). Medusa's core migration
  //    scripts normally create it; this keeps fresh/test databases self-sufficient.
  const [defaultProfile] = await fulfillmentModule.listShippingProfiles({ type: "default" })
  if (!defaultProfile) {
    await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
    })
    logger.info("[drn-0001] created default shipping profile")
  }

  // 8. Store defaults point at the Taiwan region and warehouse.
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: storeId },
      update: { default_region_id: region.id, default_location_id: location.id },
    },
  })
}
