// Who may act on an order from the storefront (P4-09 re-pay, P4-11 store reselect): its
// logged-in customer, or anyone who knows the order id AND its e-mail (guest checkout).
// Missing and not-yours answer the same, so order ids cannot be probed.
import { MedusaError } from "@medusajs/framework/utils"

export function assertOrderOwner(
  order: { customer_id?: string | null; email?: string | null } | undefined,
  actorId: string | undefined,
  email: unknown
): asserts order is { customer_id?: string | null; email?: string | null } {
  const given = typeof email === "string" ? email.trim().toLowerCase() : ""
  const owner = !!order && ((!!actorId && actorId === order.customer_id) || (!!given && given === (order.email ?? "").toLowerCase()))
  if (!owner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "找不到訂單")
  }
}
