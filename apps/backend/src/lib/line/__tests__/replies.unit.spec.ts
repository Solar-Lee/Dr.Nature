import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { BUILT_IN_REPLIES, MAX_QUICK_REPLIES, REPLIES_PATH, loadLineReplies, matchReply, parseLineReplies } from "../replies"

const FIXTURE_PATH = join(__dirname, "fixtures/line-replies.fixture.json")
const fixture = () => JSON.parse(readFileSync(FIXTURE_PATH, "utf8"))

describe("parseLineReplies", () => {
  it("accepts the shared-contract shape", () => {
    const r = parseLineReplies(fixture())
    expect(r.greeting.text).toBe("fixture greeting")
    expect(r.intents.map((i) => i.id)).toEqual(["shipping", "returns", "payment"])
  })

  it("drops keys outside the contract", () => {
    const raw = { ...fixture(), extra: 1 }
    raw.intents[0].note = "x"
    const r = parseLineReplies(raw) as unknown as Record<string, unknown>
    expect(r.extra).toBeUndefined()
    expect((r.intents as Record<string, unknown>[])[0].note).toBeUndefined()
  })

  it("lists every problem", () => {
    const raw = fixture()
    raw.version = 2
    raw.greeting = { text: " " }
    raw.handoff.keywords = ["真人", ""]
    raw.intents[1].id = "shipping"
    raw.intents[2].keywords = []
    raw.intents[2].quickReplies = Array.from({ length: MAX_QUICK_REPLIES + 1 }, () => ({ label: "a", text: "a" }))
    raw.intents[0].quickReplies[0] = { label: "", text: "x" }
    expect(() => parseLineReplies(raw)).toThrow(
      /version must be 1.*greeting\.text.*handoff\.keywords.*intents\[0\]\.quickReplies\[0\].*intents\[1\]\.id "shipping" is repeated.*intents\[2\]\.keywords.*intents\[2\]\.quickReplies has 14 buttons/
    )
  })

  it("rejects a non-object", () => {
    expect(() => parseLineReplies([])).toThrow("line-replies: not a JSON object")
  })

  it("keeps the built-in replies valid", () => {
    expect(parseLineReplies(BUILT_IN_REPLIES)).toEqual(BUILT_IN_REPLIES)
  })
})

describe("loadLineReplies", () => {
  it("reads the file when present", () => {
    expect(loadLineReplies(FIXTURE_PATH)).toMatchObject({ source: "file", replies: { greeting: { text: "fixture greeting" } } })
  })

  it("uses the built-in replies when the file is absent, without a problem", () => {
    expect(loadLineReplies(join(__dirname, "fixtures/does-not-exist.json"))).toEqual({ replies: BUILT_IN_REPLIES, source: "built-in" })
  })

  it("uses the built-in replies and reports a problem for broken JSON or a broken shape", () => {
    expect(loadLineReplies("x", () => "{not json")).toEqual({ replies: BUILT_IN_REPLIES, source: "built-in", problem: "line-replies: not valid JSON" })
    const bad = loadLineReplies("x", () => JSON.stringify({ ...fixture(), version: 3 }))
    expect(bad.source).toBe("built-in")
    expect(bad.problem).toContain("version must be 1")
  })

  it("reports an unreadable file by error code only", () => {
    const res = loadLineReplies("x", () => {
      throw Object.assign(new Error("EACCES: permission denied, open '/secret/path'"), { code: "EACCES" })
    })
    expect(res).toEqual({ replies: BUILT_IN_REPLIES, source: "built-in", problem: "line-replies: cannot read the file (EACCES)" })
  })

  // After the content lane's file is merged this checks the real file against the contract.
  ;(existsSync(REPLIES_PATH) ? it : it.skip)("parses the content file in src/data when it exists", () => {
    expect(loadLineReplies()).toMatchObject({ source: "file" })
    expect(loadLineReplies().problem).toBeUndefined()
  })
})

describe("matchReply", () => {
  const r = parseLineReplies(fixture())

  it("matches an intent keyword inside a sentence", () => {
    expect(matchReply("請問什麼時候出貨？", r)).toMatchObject({ kind: "intent", intent: { id: "shipping" }, keyword: "出貨" })
  })

  it("lets the longest keyword win across intents", () => {
    // 運費 (shipping, 2) and 退貨運費 (returns, 4) both match
    expect(matchReply("退貨運費誰付", r)).toMatchObject({ kind: "intent", intent: { id: "returns" }, keyword: "退貨運費" })
  })

  it("keeps the earlier intent on equal length", () => {
    // 出貨 (shipping) and 付款 (payment) are both two characters
    expect(matchReply("付款後多久出貨", r)).toMatchObject({ kind: "intent", intent: { id: "shipping" } })
  })

  it("prefers handoff over any intent", () => {
    expect(matchReply("退貨要找客服人員", r)).toEqual({ kind: "handoff" })
    expect(matchReply("真人", r)).toEqual({ kind: "handoff" })
  })

  it("ignores letter case and full-width forms", () => {
    expect(matchReply("可以用ａｔｍ嗎", r)).toMatchObject({ kind: "intent", intent: { id: "payment" } })
    expect(matchReply("atm", r)).toMatchObject({ kind: "intent", intent: { id: "payment" } })
  })

  it("falls back when nothing matches", () => {
    expect(matchReply("你好", r)).toEqual({ kind: "fallback" })
    expect(matchReply("", r)).toEqual({ kind: "fallback" })
  })
})
