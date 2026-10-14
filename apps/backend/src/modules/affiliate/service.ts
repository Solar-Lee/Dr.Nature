import { MedusaService } from "@medusajs/framework/utils"
import AffiliateStore from "./models/affiliate-store"
import Partner from "./models/partner"

// Generated CRUD only (listPartners, createAffiliateStores, ...); rules live in
// src/lib/affiliate/ so they can be unit tested without a database.
class AffiliateModuleService extends MedusaService({
  Partner,
  AffiliateStore,
}) {}

export default AffiliateModuleService
