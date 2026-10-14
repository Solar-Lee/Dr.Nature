// [P9-01] One affiliate partner. RBAC: GET promotion:read, POST promotion:update, DELETE
// promotion:delete. A partner with stores is never deleted (its KOL id labels exported GMV);
// set it inactive instead, which also closes its stores.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { assertKolIdFree } from "../../../../../lib/affiliate/admin"
import { PARTNER_UPDATE, parseBody } from "../../../../../lib/affiliate/rules"
import { affiliateService } from "../../../../../lib/affiliate/store"

const load = async (req: AuthenticatedMedusaRequest) => {
  const [partner] = await affiliateService(req.scope).listPartners({ id: req.params.id }, { relations: ["stores"] })
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `affiliate partner ${req.params.id} not found`)
  }
  return partner
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ partner: await load(req) })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const input = parseBody(PARTNER_UPDATE, req.body)
  const partner = await load(req)
  if (input.tuangou_kol_id !== undefined) {
    await assertKolIdFree(req.scope, input.tuangou_kol_id, partner.id)
  }
  const svc = affiliateService(req.scope)
  await svc.updatePartners({ id: partner.id, ...input })
  res.json({ partner: await load(req) })
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const partner = await load(req)
  if ((partner.stores ?? []).length) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "partner has stores; set it inactive instead of deleting it")
  }
  await affiliateService(req.scope).softDeletePartners([partner.id])
  res.json({ id: partner.id, object: "affiliate_partner", deleted: true })
}
