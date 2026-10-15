// [P9-01] Affiliate module: partners (團主 / KOL) and their stores (/s/<slug>).
import { Module } from "@medusajs/framework/utils"
import AffiliateModuleService from "./service"

export const AFFILIATE_MODULE = "affiliate"

export default Module(AFFILIATE_MODULE, {
  service: AffiliateModuleService,
})
