// [P9-01] One affiliate store. RBAC: GET promotion:read, POST promotion:update, DELETE
// promotion:delete. The partner never changes and the slug only while the store is a draft
// (attributions and shared links carry them); only drafts are deleted, a store that was open is
// set to "ended" so its orders keep their store.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { assertSlugFree, checkStoreProducts } from "../../../../../lib/affiliate/admin"
import { STORE_UPDATE, parseBody, windowOk } from "../../../../../lib/affiliate/rules"
import { affiliateService } from "../../../../../lib/affiliate/store"

const load = async (req: AuthenticatedMedusaRequest) => {
  const [store] = await affiliateService(req.scope).listAffiliateStores({ id: req.params.id }, { relations: ["partner"] })
  if (!store) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `affiliate store ${req.params.id} not found`)
  }
  return store
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ store: await load(req) })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const input = parseBody(STORE_UPDATE, req.body)
  const store = await load(req)
  const update: Record<string, unknown> = { id: store.id }
  if (input.slug !== undefined && input.slug !== store.slug) {
    if (store.status !== "draft") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "the slug can only change while the store is a draft")
    }
    await assertSlugFree(req.scope, input.slug, store.id)
    update.slug = input.slug
  }
  const starts = input.starts_at ?? store.starts_at
  const ends = input.ends_at ?? store.ends_at
  if (!windowOk({ starts_at: starts, ends_at: ends })) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "starts_at must be before ends_at")
  }
  if (input.starts_at !== undefined) update.starts_at = new Date(input.starts_at)
  if (input.ends_at !== undefined) update.ends_at = new Date(input.ends_at)
  if (input.title !== undefined) update.title = input.title
  if (input.status !== undefined) update.status = input.status
  if (input.product_ids !== undefined) update.product_ids = await checkStoreProducts(req.scope, input.product_ids)
  await affiliateService(req.scope).updateAffiliateStores(update)
  res.json({ store: await load(req) })
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const store = await load(req)
  if (store.status !== "draft") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "only draft stores can be deleted; set the store to ended instead")
  }
  await affiliateService(req.scope).softDeleteAffiliateStores([store.id])
  res.json({ id: store.id, object: "affiliate_store", deleted: true })
}
