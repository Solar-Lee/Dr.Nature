// [P9-01] Affiliate stores (/s/<slug>). RBAC: GET promotion:read, POST promotion:create.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { assertSlugFree, checkStoreProducts, pageOf } from "../../../../lib/affiliate/admin"
import { STORE_CREATE, parseBody } from "../../../../lib/affiliate/rules"
import { affiliateService } from "../../../../lib/affiliate/store"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { limit, offset } = pageOf(req.query as Record<string, unknown>)
  const filters: Record<string, string> = {}
  if (typeof req.query.partner_id === "string") filters.partner_id = req.query.partner_id
  if (typeof req.query.status === "string" && ["draft", "active", "ended"].includes(req.query.status)) filters.status = req.query.status
  const [stores, count] = await affiliateService(req.scope).listAndCountAffiliateStores(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
    relations: ["partner"],
  })
  res.json({ stores, count, limit, offset })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const input = parseBody(STORE_CREATE, req.body)
  const svc = affiliateService(req.scope)
  const [partner] = await svc.listPartners({ id: input.partner_id }, { select: ["id"] })
  if (!partner) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `affiliate partner ${input.partner_id} not found`)
  }
  await assertSlugFree(req.scope, input.slug)
  const productIds = await checkStoreProducts(req.scope, input.product_ids)
  const created = await svc.createAffiliateStores({
    partner_id: partner.id,
    slug: input.slug,
    title: input.title,
    product_ids: productIds,
    starts_at: new Date(input.starts_at),
    ends_at: new Date(input.ends_at),
    status: input.status,
  })
  const [store] = await svc.listAffiliateStores({ id: created.id }, { relations: ["partner"] })
  res.status(201).json({ store })
}
