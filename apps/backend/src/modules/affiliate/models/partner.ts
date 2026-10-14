// [P9-01] An affiliate partner (團主 / KOL). tuangou_kol_id is the KOL id in tuangou-admin, used
// as the `kol` column of the GMV export (P9-03); unique when set. A partner is never deleted
// while it has stores (the routes refuse), so exported history keeps its KOL id.
import { model } from "@medusajs/framework/utils"
import AffiliateStore from "./affiliate-store"

export const PARTNER_STATUSES = ["active", "inactive"] as const

const Partner = model.define("affiliate_partner", {
  id: model.id({ prefix: "apart" }).primaryKey(),
  display_name: model.text(),
  tuangou_kol_id: model.text().unique().nullable(),
  ig_handle: model.text().nullable(),
  status: model.enum([...PARTNER_STATUSES]).default("active"),
  stores: model.hasMany(() => AffiliateStore, { mappedBy: "partner" }),
})

export default Partner
