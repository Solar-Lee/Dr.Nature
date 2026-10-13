import { emailDeliveryFromEnv } from "../config"

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv

describe("e-mail delivery", () => {
  it("unset -> none (fail closed); log only outside production; others refused until U-09", () => {
    expect(emailDeliveryFromEnv(env({}))).toBe("none")
    expect(emailDeliveryFromEnv(env({ EMAIL_PROVIDER: "log", NODE_ENV: "test" }))).toBe("log")
    expect(() => emailDeliveryFromEnv(env({ EMAIL_PROVIDER: "log", NODE_ENV: "production" }))).toThrow(/must not be used in production/)
    expect(() => emailDeliveryFromEnv(env({ EMAIL_PROVIDER: "sendgrid" }))).toThrow(/not implemented yet/)
  })
})
