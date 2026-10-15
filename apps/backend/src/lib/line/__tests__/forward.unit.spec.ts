import { forwardLineWebhook, type ForwardFetch } from "../forward"
import { lineSignature } from "../signature"

const SECRET = "forward-test-secret-not-real"
// Pretty-printed with an escape and a trailing newline: re-serializing would change the bytes.
const BODY = Buffer.from('{\n  "destination": "U1",\n  "events": [{"type":"message","message":{"type":"text","text":"\\u8acb問運費"}}]\n}\n', "utf8")
const SIGNATURE = lineSignature(BODY, SECRET)
const URL_ = "https://bot.example.test/hooks/line?token=abc"

type Seen = { url: string; headers: Record<string, string>; body: Uint8Array }
const recorder = (answer: () => Promise<{ status: number }> = async () => ({ status: 200 })) => {
  const seen: Seen[] = []
  const fetch: ForwardFetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: init.body })
    return answer()
  }
  return { seen, fetch }
}
const logger = () => {
  const lines: string[] = []
  return { lines, warn: (m: string) => void lines.push(m) }
}

describe("forwardLineWebhook", () => {
  it("forwards the raw bytes once with the original signature and content type", async () => {
    const { seen, fetch } = recorder()
    const log = logger()
    await forwardLineWebhook({ rawBody: BODY, signature: SIGNATURE, contentType: "application/json; charset=utf-8" }, { url: URL_, fetch, logger: log })
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe(URL_)
    expect(Buffer.from(seen[0].body).equals(BODY)).toBe(true)
    expect(seen[0].headers).toEqual({ "content-type": "application/json; charset=utf-8", "x-line-signature": SIGNATURE })
    expect(log.lines).toEqual([])
  })

  it("does nothing when LINE_OA_FORWARD_URL is unset or empty", () => {
    const { seen, fetch } = recorder()
    const saved = process.env.LINE_OA_FORWARD_URL
    delete process.env.LINE_OA_FORWARD_URL
    try {
      expect(forwardLineWebhook({ rawBody: BODY, signature: SIGNATURE }, { fetch, logger: logger() })).toBeNull()
      expect(forwardLineWebhook({ rawBody: BODY, signature: SIGNATURE }, { url: "  ", fetch, logger: logger() })).toBeNull()
    } finally {
      if (saved !== undefined) process.env.LINE_OA_FORWARD_URL = saved
    }
    expect(seen).toHaveLength(0)
  })

  it("reads LINE_OA_FORWARD_URL from the environment", async () => {
    const { seen, fetch } = recorder()
    const saved = process.env.LINE_OA_FORWARD_URL
    process.env.LINE_OA_FORWARD_URL = URL_
    try {
      await forwardLineWebhook({ rawBody: BODY, signature: SIGNATURE }, { fetch, logger: logger() })
    } finally {
      if (saved === undefined) delete process.env.LINE_OA_FORWARD_URL
      else process.env.LINE_OA_FORWARD_URL = saved
    }
    expect(seen.map((s) => s.url)).toEqual([URL_])
  })

  it("never rejects and logs the reason only (status, network error, timeout, bad URL)", async () => {
    const cases: [string, ForwardFetch | undefined, string, number?][] = [
      ["status", recorder(async () => ({ status: 500 })).fetch, "[LINE-FORWARD] failed: status 500"],
      ["network", recorder(async () => Promise.reject(new TypeError("fetch failed"))).fetch, "[LINE-FORWARD] failed: network error"],
      [
        "timeout",
        (_url, init) =>
          new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })),
        "[LINE-FORWARD] failed: timeout",
        50,
      ],
    ]
    for (const [, fetch, expected, timeoutMs] of cases) {
      const log = logger()
      await expect(forwardLineWebhook({ rawBody: BODY, signature: SIGNATURE }, { url: URL_, fetch, logger: log, timeoutMs })).resolves.toBeUndefined()
      expect(log.lines).toEqual([expected])
      expect(log.lines.join()).not.toContain("token=abc")
      expect(log.lines.join()).not.toContain(SIGNATURE)
      expect(log.lines.join()).not.toContain("運費")
    }
    const log = logger()
    const { seen, fetch } = recorder()
    await forwardLineWebhook({ rawBody: BODY, signature: SIGNATURE }, { url: "ftp://bot.example.test/x", fetch, logger: log })
    await forwardLineWebhook({ rawBody: BODY, signature: SIGNATURE }, { url: "not a url", fetch, logger: log })
    expect(seen).toHaveLength(0)
    expect(log.lines).toEqual([
      "[LINE-FORWARD] failed: LINE_OA_FORWARD_URL is not an http(s) URL",
      "[LINE-FORWARD] failed: LINE_OA_FORWARD_URL is not an http(s) URL",
    ])
  })

  it("gives up after 5 s by default", async () => {
    let signal: AbortSignal | undefined
    const fetch: ForwardFetch = async (_url, init) => {
      signal = init.signal
      return { status: 200 }
    }
    const spy = jest.spyOn(AbortSignal, "timeout")
    await forwardLineWebhook({ rawBody: BODY, signature: SIGNATURE }, { url: URL_, fetch, logger: logger() })
    expect(spy).toHaveBeenCalledWith(5000)
    expect(signal).toBeDefined()
    spy.mockRestore()
  })
})
