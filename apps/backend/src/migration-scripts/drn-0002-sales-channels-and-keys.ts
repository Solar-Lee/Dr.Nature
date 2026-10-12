// [P3-05] Group-buy sales channel and one publishable API key per storefront:
//   "Official Store storefront" -> Official Store channel
//   "Group-buy storefront"      -> Group-buy channel
// The Store API scopes every /store request to the channels linked to the key in the
// x-publishable-api-key header, so the two storefronts see only their own assortment.
//
// Key tokens are public by design (sent from browsers) but are still never logged in
// full here; read them with `medusa exec ./src/scripts/print-publishable-keys.ts`.
// Idempotent: looks up channels and keys by name/title before creating.
import type { MedusaContainer } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  PUBLISHABLE_KEYS,
  SALES_CHANNELS,
  STOCK_LOCATION_NAME,
} from "../lib/drn-setup"

export default async function drnSalesChannelsAndKeys({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const apiKeyModule = container.resolve(Modules.API_KEY)
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)

  const ensureChannel = async (data: { name: string; description: string }) => {
    const [existing] = await salesChannelModule.listSalesChannels({ name: data.name })
    if (existing) {
      return existing
    }
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ ...data }] },
    })
    logger.info(`[drn-0002] created sales channel ${data.name}`)
    return result[0]
  }

  const official = await ensureChannel(SALES_CHANNELS.official)
  const groupBuy = await ensureChannel(SALES_CHANNELS.groupBuy)

  const ensureKeyLinkedTo = async (title: string, channelId: string) => {
    let [key] = await apiKeyModule.listApiKeys({ title, type: "publishable" })
    if (!key) {
      const { result } = await createApiKeysWorkflow(container).run({
        input: { api_keys: [{ title, type: "publishable", created_by: "" }] },
      })
      key = result[0]
      logger.info(`[drn-0002] created publishable key "${title}" (${key.redacted})`)
    }
    const {
      data: [withChannels],
    } = await query.graph({
      entity: "api_key",
      fields: ["id", "sales_channels.id"],
      filters: { id: key.id },
    })
    const linked = (withChannels?.sales_channels ?? []).map((sc) => sc?.id)
    if (!linked.includes(channelId)) {
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: key.id, add: [channelId] },
      })
    }
  }

  await ensureKeyLinkedTo(PUBLISHABLE_KEYS.official, official.id)
  await ensureKeyLinkedTo(PUBLISHABLE_KEYS.groupBuy, groupBuy.id)

  // The warehouse ships for both channels.
  const [location] = await stockLocationModule.listStockLocations({
    name: STOCK_LOCATION_NAME,
  })
  if (!location) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `[drn-0002] stock location "${STOCK_LOCATION_NAME}" missing; drn-0001 must run first`
    )
  }
  const {
    data: [locationLinks],
  } = await query.graph({
    entity: "stock_location",
    fields: ["id", "sales_channels.id"],
    filters: { id: location.id },
  })
  const locationChannels = (locationLinks?.sales_channels ?? []).map((sc) => sc?.id)
  const missing = [official.id, groupBuy.id].filter((id) => !locationChannels.includes(id))
  if (missing.length) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: location.id, add: missing },
    })
  }
}
