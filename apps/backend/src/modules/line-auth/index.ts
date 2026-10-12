import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import LineAuthService from "./service"

// Registered in medusa-config.ts (auth module, provider id "line") when LINE_LOGIN_* is set.
export default ModuleProvider(Modules.AUTH, {
  services: [LineAuthService],
})
