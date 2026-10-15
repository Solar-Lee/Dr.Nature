// [P6-01] RBAC policies for the blog admin routes (src/api/middlewares.ts). Medusa 2.21.2 imports
// every file in a "policies" directory under the project root (framework policies/policy-loader,
// utils policies/discover-policies, maxDepth 2) and the RBAC module syncs the registered policies
// into rbac_policy on application start (rbac-module-service syncRegisteredPolicies; this also
// runs before migration scripts, commands/db/run-scripts.js). Roles get them through drn-0004
// (fresh databases) and drn-0008 (databases seeded before P6).
import { definePolicies } from "@medusajs/framework/utils"
import { BLOG_RESOURCES } from "../lib/blog/policies"

const OPERATIONS = ["read", "create", "update", "delete"] as const

const pascal = (s: string) =>
  s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("")

export const blogPolicies = definePolicies(
  BLOG_RESOURCES.flatMap((resource) =>
    OPERATIONS.map((operation) => ({
      name: `${pascal(operation)}${pascal(resource)}`,
      resource,
      operation,
      description: `${pascal(operation)} ${resource.replace(/_/g, " ")}`,
    }))
  )
)
