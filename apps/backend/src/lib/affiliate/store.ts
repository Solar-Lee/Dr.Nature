// [P9-01] Container helpers for the affiliate routes, subscriber and export.
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { SALES_CHANNELS } from "../drn-setup"
import { AFFILIATE_MODULE } from "../../modules/affiliate"
import type AffiliateModuleService from "../../modules/affiliate/service"
import { normalizeSlug, type StoreRow } from "./rules"

export const affiliateService = (container: MedusaContainer) => container.resolve<AffiliateModuleService>(AFFILIATE_MODULE)

// The group-buy channel (P3-05). Fails closed: a renamed channel must not open stores elsewhere.
export async function groupBuyChannelId(container: MedusaContainer): Promise<string> {
  const [channel] = await container
    .resolve(Modules.SALES_CHANNEL)
    .listSalesChannels({ name: SALES_CHANNELS.groupBuy.name }, { select: ["id"] })
  if (!channel) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `sales channel "${SALES_CHANNELS.groupBuy.name}" missing (drn-0002)`)
  }
  return channel.id
}

const STORE_SELECT = {
  select: ["id", "slug", "title", "status", "starts_at", "ends_at", "partner_id", "product_ids", "price_list_id"],
  relations: ["partner"],
}

export async function storeBySlug(container: MedusaContainer, slug: unknown): Promise<StoreRow | undefined> {
  const s = normalizeSlug(slug)
  if (!s) return undefined
  const [store] = await affiliateService(container).listAffiliateStores({ slug: s }, STORE_SELECT)
  return store as unknown as StoreRow | undefined
}

export async function storesById(container: MedusaContainer, ids: string[]): Promise<Map<string, StoreRow>> {
  if (!ids.length) return new Map()
  const stores = (await affiliateService(container).listAffiliateStores({ id: ids }, STORE_SELECT)) as unknown as StoreRow[]
  return new Map(stores.map((s) => [s.id, s]))
}
