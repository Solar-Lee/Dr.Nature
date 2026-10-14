// Production must run with Redis (P12-24, deployment review D22). Without REDIS_URL Medusa only
// logs one line and falls back to its in-memory event bus, workflow engine and locking; with the
// server and the worker in separate containers, events published by one process are then never
// seen by the other, so subscribers and workflows silently stop. Refuse to boot instead.
import { MedusaError } from "@medusajs/framework/utils"

export function assertRedisForProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production" && !env.REDIS_URL) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "REDIS_URL is required in production (server and worker share events through Redis)"
    )
  }
}
