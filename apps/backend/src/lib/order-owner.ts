// Who may act on an order from the storefront (P4-09 re-pay, P4-11 store reselect): its
// logged-in customer, or a guest who gives the order's full e-mail. The e-mail is a real second
// factor only because non-owners see it masked (lib/order-privacy.ts, review logistics-1); it is
// still guessable for someone who knows the buyer, so wrong guesses are throttled per order
// (5 per 15 minutes, in-memory per server process). Missing and not-yours answer the same.
import type { ICacheService, MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"

type OwnerView = { customer_id?: string | null; email?: string | null }

export const OWNER_FAIL_LIMIT = 5
export const OWNER_FAIL_WINDOW_SECONDS = 15 * 60
export const TOO_MANY_TRIES = "嘗試次數過多，請 15 分鐘後再試。"

export function assertOrderOwner(order: OwnerView | undefined, actorId: string | undefined, email: unknown): asserts order is OwnerView {
  const given = typeof email === "string" ? email.trim().toLowerCase() : ""
  const owner = !!order && ((!!actorId && actorId === order.customer_id) || (!!given && given === (order.email ?? "").toLowerCase()))
  if (!owner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "找不到訂單")
  }
}

// Returns the order once ownership is established (async functions cannot be TS assertions).
export async function assertOrderOwnerThrottled<T extends OwnerView>(
  scope: MedusaContainer,
  orderId: string,
  order: T | undefined,
  actorId: string | undefined,
  email: unknown
): Promise<T> {
  if (actorId && order && actorId === order.customer_id) {
    return order // logged-in owners are never throttled
  }
  const cache = scope.resolve<ICacheService>(Modules.CACHE)
  const key = `drn-owner-fail:${orderId}`
  const fails = Number(await cache.get<number>(key)) || 0
  if (fails >= OWNER_FAIL_LIMIT) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, TOO_MANY_TRIES)
  }
  try {
    assertOrderOwner(order, actorId, email)
  } catch (e) {
    await cache.set(key, fails + 1, OWNER_FAIL_WINDOW_SECONDS)
    throw e
  }
  return order as T
}
