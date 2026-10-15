import { lineSignature, verifyLineSignature } from "../signature"

// Example published on developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
// (documentation values, not a real channel secret).
const DOC_SECRET = "8c570fa6dd201bb328f1c1eac23a96d8"
const DOC_BODY = '{"destination":"U8e742f61d673b39c7fff3cecb7536ef0","events":[]}'
const DOC_SIGNATURE = "GhRKmvmHys4Pi8DxkF4+EayaH0OqtJtaZxgTD9fMDLs="

const SECRET = "unit-test-channel-secret"
const BODY = JSON.stringify({
  destination: "U00000000000000000000000000000000",
  events: [{ type: "message", message: { type: "text", text: "請問運費多少？" }, webhookEventId: "01J0000000000000000000000A" }],
})

describe("verifyLineSignature", () => {
  it("matches the example published by LINE", () => {
    expect(lineSignature(DOC_BODY, DOC_SECRET)).toBe(DOC_SIGNATURE)
    expect(verifyLineSignature(Buffer.from(DOC_BODY), DOC_SECRET, DOC_SIGNATURE)).toBe(true)
  })

  it("accepts the signature of the exact raw bytes (UTF-8 text included)", () => {
    const sig = lineSignature(BODY, SECRET)
    expect(verifyLineSignature(Buffer.from(BODY, "utf8"), SECRET, sig)).toBe(true)
    expect(verifyLineSignature(BODY, SECRET, sig)).toBe(true)
  })

  it("rejects a body with one extra space", () => {
    const sig = lineSignature(BODY, SECRET)
    expect(verifyLineSignature(Buffer.from(`${BODY} `), SECRET, sig)).toBe(false)
  })

  it("rejects a tampered character", () => {
    const sig = lineSignature(BODY, SECRET)
    expect(verifyLineSignature(Buffer.from(BODY.replace("運費", "運送")), SECRET, sig)).toBe(false)
  })

  it("rejects the same content re-serialized with another key order", () => {
    const sig = lineSignature(DOC_BODY, DOC_SECRET)
    const parsed = JSON.parse(DOC_BODY) as Record<string, unknown>
    const reordered = JSON.stringify({ events: parsed.events, destination: parsed.destination })
    expect(reordered).not.toBe(DOC_BODY)
    expect(verifyLineSignature(Buffer.from(reordered), DOC_SECRET, sig)).toBe(false)
  })

  it("rejects a wrong secret", () => {
    const sig = lineSignature(BODY, "another-secret")
    expect(verifyLineSignature(Buffer.from(BODY), SECRET, sig)).toBe(false)
  })

  it("rejects a missing, empty or repeated header", () => {
    const sig = lineSignature(BODY, SECRET)
    expect(verifyLineSignature(Buffer.from(BODY), SECRET, undefined)).toBe(false)
    expect(verifyLineSignature(Buffer.from(BODY), SECRET, null)).toBe(false)
    expect(verifyLineSignature(Buffer.from(BODY), SECRET, "")).toBe(false)
    expect(verifyLineSignature(Buffer.from(BODY), SECRET, [sig, sig])).toBe(false)
  })

  it("rejects a header of another length", () => {
    const sig = lineSignature(BODY, SECRET)
    expect(verifyLineSignature(Buffer.from(BODY), SECRET, sig.slice(0, 40))).toBe(false)
    expect(verifyLineSignature(Buffer.from(BODY), SECRET, Buffer.alloc(16).toString("base64"))).toBe(false)
    expect(verifyLineSignature(Buffer.from(BODY), SECRET, Buffer.alloc(48).toString("base64"))).toBe(false)
  })

  it("rejects a header that is not Base64", () => {
    const sig = lineSignature(BODY, SECRET)
    expect(verifyLineSignature(Buffer.from(BODY), SECRET, `${sig.slice(0, 43)}!`)).toBe(false)
    expect(verifyLineSignature(Buffer.from(BODY), SECRET, Buffer.from(sig, "base64").toString("hex"))).toBe(false)
  })

  it("rejects an empty or missing body and a missing secret", () => {
    expect(verifyLineSignature(Buffer.alloc(0), SECRET, lineSignature("", SECRET))).toBe(false)
    expect(verifyLineSignature(undefined, SECRET, lineSignature(BODY, SECRET))).toBe(false)
    expect(verifyLineSignature(Buffer.from(BODY), undefined, lineSignature(BODY, SECRET))).toBe(false)
    expect(verifyLineSignature(Buffer.from(BODY), "", lineSignature(BODY, ""))).toBe(false)
  })
})
