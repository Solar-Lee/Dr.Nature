import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import EcpayLogisticsProviderService from "./service"

// Registered in medusa-config.ts with id "logistics" -> stored provider id "ecpay_logistics".
export default ModuleProvider(Modules.FULFILLMENT, {
  services: [EcpayLogisticsProviderService],
})
