import { configureStoreSearch, defineMiddlewares } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { guardVerificationConfirm, guardVerificationRequest, requireEmailProof } from "./email-verification-guards"
import { maskOrderBody } from "../lib/order-privacy"
import type {
  AuthenticatedMedusaRequest,
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
  // [P5-05] Promotion templates create a promotion and possibly its campaign.
  {
    methods: ["POST"],
    matcher: "/admin/promotion-templates",
    policies: [
      { resource: "promotion", operation: "create" },
      { resource: "campaign", operation: "create" },
    ],
  },
  // [P4-11] C2C shipment actions.
  { methods: ["POST"], matcher: "/admin/orders/:id/ecpay-logistics/return-store", policies: [{ resource: "order", operation: "update" }] },
  { methods: ["GET"], matcher: "/admin/orders/:id/ecpay-logistics/print", policies: [{ resource: "order", operation: "read" }] },
  // [P4-06] Custom e-invoice actions: same permission as editing an order.
  ...["/admin/orders/:id/ecpay-invoice/issue", "/admin/orders/:id/ecpay-invoice/void"].map((matcher) => ({
    methods: ["POST"],
    matcher,
    policies: [{ resource: "order", operation: "update" }],
  })),
  { methods: ["POST"], matcher: "/admin/index/sync", policies: SUPER_ADMIN_ONLY },
  { methods: ["DELETE"], matcher: "/admin/search-indexes/:id", policies: SUPER_ADMIN_ONLY },
  { methods: ["POST"], matcher: "/admin/search-indexes/:id/reindex", policies: SUPER_ADMIN_ONLY },
  { methods: ["POST"], matcher: "/admin/property-labels", policies: SUPER_ADMIN_ONLY },
  { methods: ["POST"], matcher: "/admin/property-labels/batch", policies: SUPER_ADMIN_ONLY },
  { methods: ["POST", "DELETE"], matcher: "/admin/property-labels/:id", policies: SUPER_ADMIN_ONLY },
] as MiddlewareRoute[]).map((entry) => ({ ...entry, middlewares: [requirePolicies] }))

// ECPay (P4-03 review): once a cart is completed into an order, Medusa 2.21.2 still lets the
// storefront create a new payment session on its collection, which deletes the old session
// while its ECPay form can still be paid. Block it until a deliberate re-pay flow (P4-09)
// exists. The check runs before Medusa's own route handler.
const blockSessionsOnPlacedOrders = async (
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: links } = await query.graph({
      entity: "cart_payment_collection",
      fields: ["cart.completed_at"],
      filters: { payment_collection_id: req.params.id },
    })
    if (links.some((l: any) => l?.cart?.completed_at)) {
      return next(
        new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "This order has already been placed; payment can only be retried from the order page."
        )
      )
    }
    return next()
  } catch (e) {
    return next(e)
  }
}

// [P5-03 review membership-4] Customers may write their own metadata through the Store API
// (Medusa 2.21.2 StoreCreateCustomer / StoreUpdateCustomer accept any metadata, merged
// shallowly). Keys starting with drn_ belong to the project (tier snapshot and change log), so
// shoppers must not set or erase them.
const RESERVED_METADATA_PREFIX = "drn_"
const rejectReservedCustomerMetadata = (req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) => {
  const metadata = (req.body as { metadata?: unknown } | undefined)?.metadata
  if (metadata && typeof metadata === "object" && Object.keys(metadata).some((k) => k.startsWith(RESERVED_METADATA_PREFIX))) {
    return next(new MedusaError(MedusaError.Types.INVALID_DATA, `metadata keys starting with ${RESERVED_METADATA_PREFIX} are reserved`))
  }
  return next()
}

// [P4-11 review logistics-1] Order privacy. Medusa 2.21.2 serves orders by id alone and the id
// is not a secret, so non-owners (anyone but the logged-in customer the order belongs to) get a
// masked order (lib/order-privacy.ts); a completed cart is not shown to non-owners (it holds the
// same e-mail and phone); order transfer is not offered: in 2.21.2 ANY registered customer may
// request the transfer of ANY order id, which answers with the order and leaves a REQUESTED
// order change that blocks fulfillment, shipment and delivery until handled.
const ownerOf = async (req: MedusaRequest, entity: "order" | "cart") => {
  const { data } = await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity,
    fields: entity === "cart" ? ["id", "customer_id", "completed_at"] : ["id", "customer_id"],
    filters: { id: req.params.id },
  })
  const row = data[0] as { customer_id?: string | null; completed_at?: unknown } | undefined
  const actor = (req as AuthenticatedMedusaRequest).auth_context?.actor_id
  return { row, owner: !!row && !!actor && actor === row.customer_id }
}
const maskUnlessOwner = (entity: "order" | "cart") => async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
  try {
    if (!(await ownerOf(req, entity)).owner) {
      const send = res.json.bind(res)
      res.json = ((body: unknown) => send(maskOrderBody(body))) as typeof res.json
    }
    return next()
  } catch (e) {
    return next(e)
  }
}
const hideCompletedCart = async (req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) => {
  try {
    const { row, owner } = await ownerOf(req, "cart")
    return next(row?.completed_at && !owner ? new MedusaError(MedusaError.Types.NOT_FOUND, `Cart id not found: ${req.params.id}`) : undefined)
  } catch (e) {
    return next(e)
  }
}
const notOffered = (_req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) =>
  next(new MedusaError(MedusaError.Types.NOT_FOUND, "Not found"))

// [P4-09 review, design H1] Medusa 2.21.2's public POST /hooks/payment/:provider queues every
// body for the payment-webhook subscriber, which runs processPaymentWorkflow on any SUCCESSFUL
// action (@medusajs/medusa dist/api/hooks/payment/[provider]/route.js, dist/subscribers/
// payment-webhook.js); the ECPay provider answers SUCCESSFUL for any validly signed RtnCode=1
// notice. A replayed signed notice would then bypass the collection lock and the canceled-order
// / paid-twice guards of lib/ecpay/record-payment.ts, and a capture after a cancel turns the
// CANCELED collection back to COMPLETED (payment-module.js:534-588). ECPay only calls
// /hooks/ecpay/*, so the built-in route is closed for this provider (the module accepts the id
// with or without "pp_", payment-module.js:696-700).
const ECPAY_BUILTIN_WEBHOOKS = ["/hooks/payment/ecpay_ecpay", "/hooks/payment/pp_ecpay_ecpay"]

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
    {
      methods: ["POST"],
      matcher: "/store/payment-collections/:id/payment-sessions",
      middlewares: [blockSessionsOnPlacedOrders],
    },
    // [P5-01 review auth-2] e-mail ownership before a customer account claims an e-mail.
    { methods: ["POST"], matcher: "/store/customers", middlewares: [rejectReservedCustomerMetadata, requireEmailProof] },
    { methods: ["POST"], matcher: "/auth/verification/request", middlewares: [guardVerificationRequest] },
    { methods: ["POST"], matcher: "/auth/verification/confirm", middlewares: [guardVerificationConfirm] },
    { methods: ["POST"], matcher: "/store/customers/me", middlewares: [rejectReservedCustomerMetadata] },
    // [P4-11 review logistics-1] order privacy
    { methods: ["GET"], matcher: "/store/orders/:id", middlewares: [maskUnlessOwner("order")] },
    { methods: ["POST"], matcher: "/store/carts/:id/complete", middlewares: [maskUnlessOwner("cart")] },
    { methods: ["GET"], matcher: "/store/carts/:id", middlewares: [hideCompletedCart] },
    // Exact matchers: a /transfer/:action param leaf would sort after core's static leaves.
    ...["request", "cancel", "accept", "decline"].map((action) => ({
      methods: ["POST" as const],
      matcher: `/store/orders/:id/transfer/${action}`,
      middlewares: [notOffered],
    })),
    ...ECPAY_BUILTIN_WEBHOOKS.map((matcher) => ({ methods: ["POST" as const], matcher, middlewares: [notOffered] })),
  ],
})
