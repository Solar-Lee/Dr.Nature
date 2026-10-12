import { configureStoreSearch, defineMiddlewares } from "@medusajs/framework/http"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareRoute,
} from "@medusajs/framework/http"

// Pass-through handler for entries that only add an RBAC policy check.
const requirePolicies = (_req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) =>
  next()

// RBAC hardening (P3-07 review, 2026-10-13). In Medusa 2.21.2 these admin write routes
// declare no policy of their own, so any role holding the wildcard read policy for the
// path (e.g. product:read) could call them. Each entry below adds the policy the route
// should have required. Found by enumerating @medusajs/medusa/dist/api/middlewares.js;
// re-run that audit on every Medusa upgrade (docs/research/medusa-p3.md).
// Policies on these entries are checked in addition to Medusa's own.
const SUPER_ADMIN_ONLY = [{ resource: "store", operation: "update" }] // no staff role has store:update

const rbacHardening: MiddlewareRoute[] = ([
  { methods: ["POST"], matcher: "/admin/products/:id", policies: [{ resource: "product", operation: "update" }] },
  {
    methods: ["POST"],
    matcher: "/admin/products/:id/variants/:variant_id",
    policies: [
      { resource: "product_variant", operation: "update" },
      { resource: "price", operation: "update" },
    ],
  },
  {
    methods: ["POST"],
    matcher: "/admin/products/:id/images/:image_id/variants/batch",
    policies: [{ resource: "product_variant", operation: "update" }],
  },
  {
    methods: ["POST"],
    matcher: "/admin/products/:id/variants/:variant_id/images/batch",
    policies: [{ resource: "product_variant", operation: "update" }],
  },
  // Imports can create/update products and prices in bulk.
  ...["/admin/products/import", "/admin/products/imports", "/admin/products/import/:transaction_id/confirm"].map(
    (matcher) => ({
      methods: ["POST"],
      matcher,
      policies: [
        { resource: "product", operation: "create" },
        { resource: "product", operation: "update" },
        { resource: "price", operation: "create" },
      ],
    })
  ),
  // Running or force-completing arbitrary workflows must never be open to staff roles.
  ...[
    "/admin/workflows-executions/:workflow_id/run",
    "/admin/workflows-executions/:workflow_id/steps/success",
    "/admin/workflows-executions/:workflow_id/steps/failure",
  ].map((matcher) => ({
    methods: ["POST"],
    matcher,
    policies: [{ resource: "workflow_execution", operation: "create" }],
  })),
  { methods: ["POST"], matcher: "/admin/rbac/roles", policies: [{ resource: "rbac_role", operation: "create" }] },
  { methods: ["POST"], matcher: "/admin/index/sync", policies: SUPER_ADMIN_ONLY },
  { methods: ["DELETE"], matcher: "/admin/search-indexes/:id", policies: SUPER_ADMIN_ONLY },
  { methods: ["POST"], matcher: "/admin/search-indexes/:id/reindex", policies: SUPER_ADMIN_ONLY },
  { methods: ["POST"], matcher: "/admin/property-labels", policies: SUPER_ADMIN_ONLY },
  { methods: ["POST"], matcher: "/admin/property-labels/batch", policies: SUPER_ADMIN_ONLY },
  { methods: ["POST", "DELETE"], matcher: "/admin/property-labels/:id", policies: SUPER_ADMIN_ONLY },
] as MiddlewareRoute[]).map((entry) => ({ ...entry, middlewares: [requirePolicies] }))

// The product index declares filterable `status` and `sales_channel_ids`, so
// the route narrows it to published products in the key's sales channels.
export default defineMiddlewares({
  routes: [
    {
      methods: ["POST"],
      matcher: "/store/search",
      middlewares: [
        configureStoreSearch({
          allowed_indexes: {
            product: true,
          },
        }),
      ],
    },
    ...rbacHardening,
  ],
})
