// [P12-20a] Scheduler liveness: every 10 minutes write "[JOB-HEARTBEAT] scheduler alive" so the
// host monitor can tell "worker process up" from "cron scheduler stalled" (lib/ops/job-heartbeat.ts).
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { logJobHeartbeat } from "../lib/ops/job-heartbeat"

export default async function drnJobHeartbeat(container: MedusaContainer) {
  logJobHeartbeat(container.resolve(ContainerRegistrationKeys.LOGGER))
}

export const config = {
  name: "drn-job-heartbeat",
  schedule: "*/10 * * * *",
}
