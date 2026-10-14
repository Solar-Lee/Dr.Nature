// [P6-01] Custom data module "blog" (registered in medusa-config.ts). Resolve it with
// container.resolve<BlogModuleService>(BLOG_MODULE).
import { Module } from "@medusajs/framework/utils"
import BlogModuleService from "./service"

export const BLOG_MODULE = "blog"

export default Module(BLOG_MODULE, { service: BlogModuleService })
