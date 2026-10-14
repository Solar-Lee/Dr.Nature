// [P9-01] Shared checks for the admin affiliate routes (src/api/admin/affiliate/**).
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { affiliateService, groupBuyChannelId } from "./store"

export const pageOf = (query: Record<string, unknown>) => {
  const limit = Math.min(Math.max(Number.parseInt(String(query.limit ?? "50"), 10) || 50, 1), 200)
  const offset = Math.max(Number.parseInt(String(query.offset ?? "0"), 10) || 0, 0)
  return { limit, offset }
}

// Every selected product must exist, be published and be sold in the group-buy channel: the store
// page lists only those, so anything else would silently vanish from the store.
export async function checkStoreProducts(container: MedusaContainer, ids: string[]) {
  const unique = [...new Set(ids)]
  const channelId = await groupBuyChannelId(container)
  const { data } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "product",
    fields: ["id", "status", "sales_channels.id"],
    filters: { id: unique },
  })
  const rows = data as { id: string; status: string; sales_channels?: ({ id: string } | null)[] | null }[]
  const bad = unique.filter((id) => {
    const p = rows.find((r) => r.id === id)
    return !p || p.status !== "published" || !(p.sales_channels ?? []).some((sc) => sc?.id === channelId)
  })
  if (bad.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `product(s) not published in the group-buy channel: ${bad.join(", ")}`)
  }
  return unique
}

export async function assertSlugFree(container: MedusaContainer, slug: string, exceptId?: string) {
  const taken = await affiliateService(container).listAffiliateStores({ slug }, { select: ["id"] })
  if (taken.some((s) => s.id !== exceptId)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `slug "${slug}" is already used by another store`)
  }
}

export async function assertKolIdFree(container: MedusaContainer, kolId: string | null | undefined, exceptId?: string) {
  if (!kolId) return
  const taken = await affiliateService(container).listPartners({ tuangou_kol_id: kolId }, { select: ["id"] })
  if (taken.some((p) => p.id !== exceptId)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `tuangou_kol_id "${kolId}" is already used by another partner`)
  }
}
