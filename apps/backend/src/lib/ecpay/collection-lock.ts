// One lock per ECPay payment collection (P4-09; reviews payments-3, payments-4, cross-1, cross-4).
// Every path that decides on or changes an ECPay collection's payment state holds it:
// recordVerifiedPayment (ReturnURL, P4-10 reconcile, P4-07 daily file), the unpaid-cancel job,
// re-pay, and the PaymentInfoURL attach. Keyed by the collection, not the order: the ReturnURL
// and reconcile paths only know session -> payment_collection_id, and the order may not exist
// yet (processPaymentWorkflow completes the cart).
// Medusa 2.21.2 locking (@medusajs/locking dist/providers/in-memory.js, @medusajs/locking-redis
// dist/services/redis-lock.js):
//  - execute() is NOT re-entrant: every call takes a fresh owner (in-memory.js:29,
//    redis-lock.js:129), so a nested call for the same collection waits for itself until its
//    timeout. Code already holding the lock calls the *Held variants, never this again.
//  - timeout = seconds to WAIT for the lock, at least 1 (in-memory.js:25). The lock is held
//    until fn settles (in-memory) or under a 60 s lease renewed every 20 s (Redis,
//    redis-lock.js:121-162); no `expire` is passed, so the default lease applies.
//  - a wait timeout is a plain Error in-memory (HTTP 500, in-memory.js:140) but a CONFLICT in
//    Redis (409, redis-lock.js:299): both become CONFLICT here, so tests (in-memory) and
//    production (Redis) behave alike.
//  - several keys: in-memory takes them one after another and keeps the earlier ones while it
//    waits (in-memory.js:60-98), so keys are sorted: two callers never wait on each other.
//  - Redis can lose a lease while fn runs and then throws CONFLICT AFTER fn finished
//    (redis-lock.js:151-159): callers must stay idempotent (they are: every path re-reads).
// Lock order is always this lock, then Medusa's cart lock (processPaymentWorkflow and
// completeCartWorkflow take it); nothing takes them the other way round.
// Tests run the in-memory provider (REDIS_URL is empty), so cross-process exclusion between
// the server and the worker exists only with Redis in production.
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"

export const collectionLockKey = (paymentCollectionId: string) => `drn-ecpay-pc:${paymentCollectionId}`

export async function withCollectionLock<T>(
  container: MedusaContainer,
  paymentCollectionIds: string | string[],
  fn: () => Promise<T>,
  timeoutSeconds: number
): Promise<T> {
  const keys = [...new Set([paymentCollectionIds].flat())].sort().map(collectionLockKey)
  let started = false
  try {
    return await container.resolve(Modules.LOCKING).execute(
      keys,
      async () => {
        started = true
        return fn()
      },
      { timeout: timeoutSeconds }
    )
  } catch (e) {
    if (!started) {
      throw new MedusaError(MedusaError.Types.CONFLICT, `ECPay payment collection busy (${keys.join(", ")}): ${(e as Error).message}`)
    }
    throw e
  }
}
