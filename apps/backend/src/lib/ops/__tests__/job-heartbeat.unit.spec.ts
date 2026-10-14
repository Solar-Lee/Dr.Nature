import { JOB_HEARTBEAT_TAG, logJobHeartbeat } from "../job-heartbeat"

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv

describe("job heartbeat", () => {
  it("writes one info line tagged [JOB-HEARTBEAT] (the exact tag the host monitor greps)", () => {
    const lines: string[] = []
    expect(logJobHeartbeat({ info: (m) => lines.push(m) }, env({ NODE_ENV: "production" }))).toBe(true)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("[JOB-HEARTBEAT]")
    expect(JOB_HEARTBEAT_TAG).toEqual("[JOB-HEARTBEAT]")
  })

  it("stays silent under NODE_ENV=test", () => {
    const lines: string[] = []
    expect(logJobHeartbeat({ info: (m) => lines.push(m) }, env({ NODE_ENV: "test" }))).toBe(false)
    expect(lines).toEqual([])
  })
})
