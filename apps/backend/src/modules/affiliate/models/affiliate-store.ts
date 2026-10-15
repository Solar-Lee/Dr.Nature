// [P9-01] An affiliate store (分潤賣場, storefront path /s/<slug>): a partner's selection of
// products for one period. A store attributes carts only while status is "active", its partner
// is active and starts_at <= now < ends_at (src/lib/affiliate/rules.ts). price_list_id is the
// store-only price list (P9-02).
import { model } from "@medusajs/framework/utils"
import Partner from "./partner"

export const STORE_STATUSES = ["draft", "active", "ended"] as const

const AffiliateStore = model.define("affiliate_store", {
  id: model.id({ prefix: "astore" }).primaryKey(),
  slug: model.text().unique(),
  title: model.text(),
  product_ids: model.array(),
  starts_at: model.dateTime(),
  ends_at: model.dateTime(),
  status: model.enum([...STORE_STATUSES]).default("draft"),
  price_list_id: model.text().nullable(),
  partner: model.belongsTo(() => Partner, { mappedBy: "stores" }),
})

export default AffiliateStore
