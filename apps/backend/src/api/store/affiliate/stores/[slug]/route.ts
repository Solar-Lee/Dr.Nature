// [P9-01] GET /store/affiliate/stores/:slug: an open affiliate store (status active, its partner
// active, starts_at <= now < ends_at) on the group-buy storefront, with its partner's display name
// and its selected products (published, sold in the group-buy channel, in the store's order).
// Anything else answers 404 with the same message.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { openStoreForRequest } from "../../../../../lib/affiliate/shopper"

type ProductRow = {
  id: string
  status: string
  sales_channels?: ({ id: string } | null)[] | null
  [k: string]: unknown
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { store, channelId } = await openStoreForRequest(req, req.params.slug, new Date())
  const ids = store.product_ids ?? []
  const { data } = ids.length
    ? await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({
        entity: "product",
        fields: ["id", "title", "subtitle", "handle", "thumbnail", "status", "sales_channels.id", "variants.id", "variants.title", "variants.sku"],
        filters: { id: ids },
      })
    : { data: [] }
  const byId = new Map((data as ProductRow[]).map((p) => [p.id, p]))
  const products = ids
    .map((id) => byId.get(id))
    .filter((p): p is ProductRow => !!p && p.status === "published" && (p.sales_channels ?? []).some((sc) => sc?.id === channelId))
    .map(({ status: _s, sales_channels: _c, ...p }) => p)
  res.json({
    store: {
      slug: store.slug,
      title: store.title,
      starts_at: store.starts_at,
      ends_at: store.ends_at,
      partner: { display_name: store.partner?.display_name ?? null },
      products,
    },
  })
}
