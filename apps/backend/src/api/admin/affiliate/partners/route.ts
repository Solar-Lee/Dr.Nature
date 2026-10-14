// [P9-01] Affiliate partners (團主 / KOL). RBAC (src/api/middlewares.ts): GET promotion:read,
// POST promotion:create (operations and Super Admin; finance may read).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { assertKolIdFree, pageOf } from "../../../../lib/affiliate/admin"
import { PARTNER_CREATE, parseBody } from "../../../../lib/affiliate/rules"
import { affiliateService } from "../../../../lib/affiliate/store"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { limit, offset } = pageOf(req.query as Record<string, unknown>)
  const status = req.query.status
  const filters = status === "active" || status === "inactive" ? { status } : {}
  const [partners, count] = await affiliateService(req.scope).listAndCountPartners(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })
  res.json({ partners, count, limit, offset })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const input = parseBody(PARTNER_CREATE, req.body)
  await assertKolIdFree(req.scope, input.tuangou_kol_id)
  const partner = await affiliateService(req.scope).createPartners({
    display_name: input.display_name,
    tuangou_kol_id: input.tuangou_kol_id ?? null,
    ig_handle: input.ig_handle ?? null,
    status: input.status,
  })
  res.status(201).json({ partner })
}
