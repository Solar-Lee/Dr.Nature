// [P3-04] Product catalog from content/products/catalog.json (synced into
// src/data/catalog.json by scripts/sync-catalog.mjs; a test fails if they differ).
// Creates only products whose handle does not exist yet, sells them in both sales
// channels at the catalog price (TWD, tax-inclusive via the store currency preference),
// and stocks the warehouse at 0. Real stock is entered by operations; dev/test stock
// comes from src/scripts/dev-add-test-stock.ts.
import type { MedusaContainer } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows"
import catalog from "../data/catalog.json"
import { CURRENCY_CODE, SALES_CHANNELS, STOCK_LOCATION_NAME } from "../lib/drn-setup"

export const OPTION_TITLE = "規格"

export const optionValueFor = (capsules: number) => `${capsules} 顆`

export default async function drnCatalog({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModule = container.resolve(Modules.PRODUCT)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)

  if (catalog.currency !== CURRENCY_CODE) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `[drn-0003] catalog currency ${catalog.currency} != ${CURRENCY_CODE}`)
  }

  const channels = await salesChannelModule.listSalesChannels({
    name: [SALES_CHANNELS.official.name, SALES_CHANNELS.groupBuy.name],
  })
  const [location] = await stockLocationModule.listStockLocations({
    name: STOCK_LOCATION_NAME,
  })
  const [shippingProfile] = await fulfillmentModule.listShippingProfiles({
    type: "default",
  })
  if (channels.length !== 2 || !location || !shippingProfile) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "[drn-0003] prerequisites missing (sales channels, stock location or default shipping profile); drn-0001/0002 must run first"
    )
  }

  const handles = catalog.products.map((p) => p.handle)
  const existing = await productModule.listProducts({ handle: handles })
  const existingHandles = new Set(existing.map((p) => p.handle))
  const toCreate = catalog.products.filter((p) => !existingHandles.has(p.handle))

  // createProductsWorkflow commits in separate steps (product, channel links, then
  // variants/prices/inventory). If a previous run was killed mid-way, an existing handle
  // may be a half-built product. Refuse to continue rather than skip it silently: the
  // script stays pending and the product must be repaired or deleted by hand.
  if (existing.length) {
    const { data: built } = await query.graph({
      entity: "product",
      fields: ["handle", "variants.sku", "variants.prices.amount", "variants.prices.currency_code", "sales_channels.id"],
      filters: { handle: [...existingHandles] },
    })
    const channelIds = channels.map((c) => c.id)
    const incomplete = catalog.products
      .filter((p) => existingHandles.has(p.handle))
      .filter((p) => {
        // `variants.prices` resolves through a module link, which query.graph's
        // generated types do not include.
        const product: any = built.find((b) => b.handle === p.handle)
        const variant = (product?.variants ?? []).find((v: any) => v?.sku === p.sku)
        const hasPrice = (variant?.prices ?? []).some(
          (pr: any) => pr?.currency_code === CURRENCY_CODE && Number(pr?.amount) === p.price
        )
        const linked = (product?.sales_channels ?? []).map((sc: any) => sc?.id)
        return !variant || !hasPrice || !channelIds.every((id) => linked.includes(id))
      })
    if (incomplete.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `[drn-0003] existing product(s) incomplete (missing SKU variant, TWD price or sales channel): ${incomplete
          .map((p) => p.handle)
          .join(", ")}. Repair or delete them, then re-run db:migrate:scripts.`
      )
    }
  }

  if (toCreate.length) {
    await createProductsWorkflow(container).run({
      input: {
        products: toCreate.map((p) => ({
          title: p.title,
          subtitle: p.subtitle,
          handle: p.handle,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          metadata: {
            series: p.series,
            capsules: p.capsules,
            shelf_life_months: p.shelf_life_months,
          },
          options: [{ title: OPTION_TITLE, values: [optionValueFor(p.capsules)] }],
          variants: [
            {
              title: optionValueFor(p.capsules),
              sku: p.sku,
              ean: p.ean13 ?? undefined,
              manage_inventory: true,
              allow_backorder: false,
              options: { [OPTION_TITLE]: optionValueFor(p.capsules) },
              prices: [{ currency_code: CURRENCY_CODE, amount: p.price }],
            },
          ],
          sales_channels: channels.map((c) => ({ id: c.id })),
        })),
      },
    })
    logger.info(`[drn-0003] created ${toCreate.length} product(s)`)
  }

  // Every catalog SKU gets an inventory level at the warehouse (0 on hand).
  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku", "location_levels.location_id"],
    filters: { sku: catalog.products.map((p) => p.sku) },
  })
  const missingLevels = items.filter(
    (item) =>
      !(item.location_levels ?? []).some((lvl) => lvl?.location_id === location.id)
  )
  if (missingLevels.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: missingLevels.map((item) => ({
          inventory_item_id: item.id,
          location_id: location.id,
          stocked_quantity: 0,
        })),
      },
    })
  }
}
