import { RecentIds } from "../dedupe"
import { parseCallbackBody } from "../events"

describe("RecentIds", () => {
  it("is true the first time and false for a repeat", () => {
    const seen = new RecentIds(10)
    expect(seen.firstSeen("01J000000000000000000000A1")).toBe(true)
    expect(seen.firstSeen("01J000000000000000000000A1")).toBe(false)
    expect(seen.firstSeen("01J000000000000000000000A2")).toBe(true)
  })

  it("forgets the oldest id beyond the bound and keeps repeated ids longer", () => {
    const seen = new RecentIds(3)
    for (const id of ["a", "b", "c"]) seen.firstSeen(id)
    expect(seen.firstSeen("a")).toBe(false) // refreshes "a"; "b" is now the oldest
    expect(seen.firstSeen("d")).toBe(true) // evicts "b"
    expect(seen.size).toBe(3)
    expect(seen.firstSeen("a")).toBe(false)
    expect(seen.firstSeen("b")).toBe(true)
  })
})

describe("parseCallbackBody", () => {
  it("reads destination and events", () => {
    const body = parseCallbackBody(
      Buffer.from('{"destination":"U1","events":[{"type":"follow","webhookEventId":"01J1"},{"type":"message"}]}')
    )
    expect(body).toEqual({
      destination: "U1",
      events: [{ type: "follow", webhookEventId: "01J1" }, { type: "message" }],
    })
  })

  it("accepts the empty events array LINE's Verify button sends", () => {
    expect(parseCallbackBody(Buffer.from('{"destination":"U1","events":[]}'))).toEqual({ destination: "U1", events: [] })
  })

  it("drops events that are not objects with a type", () => {
    const body = parseCallbackBody(Buffer.from('{"events":[1,null,"x",{"type":3},{"type":"unfollow"}]}'))
    expect(body?.events).toEqual([{ type: "unfollow" }])
  })

  it("returns null for non-JSON or a body without an events array", () => {
    expect(parseCallbackBody(Buffer.from("not json"))).toBeNull()
    expect(parseCallbackBody(Buffer.from('{"destination":"U1"}'))).toBeNull()
    expect(parseCallbackBody(Buffer.from("[]"))).toBeNull()
    expect(parseCallbackBody(Buffer.from('{"events":{}}'))).toBeNull()
  })
})
