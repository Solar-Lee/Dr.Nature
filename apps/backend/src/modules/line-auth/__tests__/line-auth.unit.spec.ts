import LineAuthService from "../service"

describe("LINE provider options", () => {
  const ok = { channelId: "1650000000", channelSecret: "s", callbackUrl: "https://x.tw/auth/callback/line" }
  const prev = process.env.NODE_ENV
  afterEach(() => {
    process.env.NODE_ENV = prev
  })

  it("needs channel id, secret and callback URL", () => {
    expect(() => LineAuthService.validateOptions(ok)).not.toThrow()
    for (const k of Object.keys(ok)) {
      expect(() => LineAuthService.validateOptions({ ...ok, [k]: "" })).toThrow(new RegExp(k))
    }
  })

  it("refuses the stub URL in production", () => {
    process.env.NODE_ENV = "production"
    expect(() => LineAuthService.validateOptions({ ...ok, apiBaseUrl: "http://127.0.0.1:56393" })).toThrow(/must not be set in production/)
  })
})
