// Scheduler liveness (P12-20a, deployment review D23). The worker's /health only proves the
// process is up; this line proves the cron scheduler fires. The host monitor fails the
// drn-heartbeat check when the worker's log has no such line in the last 21 minutes (two
// schedules plus slack), unless the worker started less than 21 minutes ago.
export const JOB_HEARTBEAT_TAG = "[JOB-HEARTBEAT]"

export type HeartbeatLogger = { info: (message: string) => unknown }

// Returns true when a line was written (tests run with NODE_ENV=test and must stay silent).
export function logJobHeartbeat(logger: HeartbeatLogger, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "test") {
    return false
  }
  logger.info(`${JOB_HEARTBEAT_TAG} scheduler alive`)
  return true
}
