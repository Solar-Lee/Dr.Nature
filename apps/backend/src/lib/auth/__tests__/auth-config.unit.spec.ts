import { OAUTH_CALLBACK_PATHS, authProvidersFromEnv } from "../config"

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv

describe("login providers from env", () => {
  it("without OAuth credentials: e-mail + password only", () => {
    expect(authProvidersFromEnv(env({}))).toEqual({
      providers: [{ resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" }],
      customerMethods: ["emailpass"],
    })
  })

  it("Google and LINE register with storefront callbacks; the LINE stub URL is passed through", () => {
    const r = authProvidersFromEnv(
      env({
        STOREFRONT_URL: "https://dr.nature.smilelife.tw/",
        GOOGLE_OAUTH_CLIENT_ID: "gid",
        GOOGLE_OAUTH_CLIENT_SECRET: "gsecret",
        LINE_LOGIN_CHANNEL_ID: "1650000000",
        LINE_LOGIN_CHANNEL_SECRET: "lsecret",
        LINE_LOGIN_API_BASE_URL: "http://127.0.0.1:56393",
      })
    )
    expect(r.customerMethods).toEqual(["emailpass", "google", "line"])
    expect(r.providers[1]).toEqual({
      resolve: "@medusajs/medusa/auth-google",
      id: "google",
      options: { clientId: "gid", clientSecret: "gsecret", callbackUrl: `https://dr.nature.smilelife.tw${OAUTH_CALLBACK_PATHS.google}` },
    })
    expect(r.providers[2]).toEqual({
      resolve: "./src/modules/line-auth",
      id: "line",
      options: { channelId: "1650000000", channelSecret: "lsecret", callbackUrl: "https://dr.nature.smilelife.tw/auth/callback/line", apiBaseUrl: "http://127.0.0.1:56393" },
    })
  })

  it("fails closed on half a credential pair, a missing storefront URL, or plain http in production", () => {
    expect(() => authProvidersFromEnv(env({ STOREFRONT_URL: "https://x.tw", LINE_LOGIN_CHANNEL_ID: "1" }))).toThrow(/must be set together/)
    expect(() => authProvidersFromEnv(env({ GOOGLE_OAUTH_CLIENT_SECRET: "s" }))).toThrow(/must be set together/)
    expect(() => authProvidersFromEnv(env({ GOOGLE_OAUTH_CLIENT_ID: "i", GOOGLE_OAUTH_CLIENT_SECRET: "s" }))).toThrow(/STOREFRONT_URL is required/)
    expect(() =>
      authProvidersFromEnv(env({ NODE_ENV: "production", STOREFRONT_URL: "http://x.tw", GOOGLE_OAUTH_CLIENT_ID: "i", GOOGLE_OAUTH_CLIENT_SECRET: "s" }))
    ).toThrow(/https in production/)
  })
})
