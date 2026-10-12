// Dev/test only: sets 100 units on hand for every catalog SKU at the TW warehouse.
// Runs only with NODE_ENV=development|test against a local database (fails closed). Usage (from apps/backend):
//   ../../infra/dev-env.sh pnpm exec medusa exec ./src/scripts/dev-add-test-stock.ts
import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { batchInventoryItemLevelsWorkflow } from "@medusajs/medusa/core-flows"
import catalog from "../data/catalog.json"
import { STOCK_LOCATION_NAME } from "../lib/drn-setup"

export const DEV_STOCK_QUANTITY = 100

export default async function devAddTestStock({ container }: ExecArgs) {
  // Fail closed: `medusa exec` does not default NODE_ENV, so require an explicit dev/test
  // environment AND a local database before touching stock.
  const env = process.env.NODE_ENV
  const dbUrl = process.env.DATABASE_URL ?? ""
  const localDb =
    env === "test"
      ? process.env.DB_HOST === "localhost"
      : /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(dbUrl)
  if ((env !== "development" && env !== "test") || !localDb) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "dev-add-test-stock runs only with NODE_ENV=development|test against a local database"
    )
  }
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)

  const [location] = await stockLocationModule.listStockLocations({
    name: STOCK_LOCATION_NAME,
  })
  if (!location) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `stock location "${STOCK_LOCATION_NAME}" not found; run db:migrate first`)
  }
  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
    filters: { sku: catalog.products.map((p) => p.sku) },
  })
  await batchInventoryItemLevelsWorkflow(container).run({
    input: {
      update: items.map((item) => ({
        inventory_item_id: item.id,
        location_id: location.id,
        stocked_quantity: DEV_STOCK_QUANTITY,
      })),
    },
  })
  logger.info(`dev stock set to ${DEV_STOCK_QUANTITY} for ${items.length} SKU(s)`)
}
