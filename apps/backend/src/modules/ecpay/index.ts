import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import EcpayPaymentProviderService from "./service"

// Registered in medusa-config.ts with id "ecpay" -> provider id pp_ecpay_ecpay.
export default ModuleProvider(Modules.PAYMENT, {
  services: [EcpayPaymentProviderService],
})
