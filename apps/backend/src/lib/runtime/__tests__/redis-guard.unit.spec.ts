import { assertRedisForProduction } from "../redis-guard"

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv

describe("redis guard", () => {
  it("production without REDIS_URL refuses to boot", () => {
    expect(() => assertRedisForProduction(env({ NODE_ENV: "production" }))).toThrow(/REDIS_URL is required in production/)
    expect(() => assertRedisForProduction(env({ NODE_ENV: "production", REDIS_URL: "" }))).toThrow(/REDIS_URL is required/)
  })

  it("production with REDIS_URL boots", () => {
    expect(() => assertRedisForProduction(env({ NODE_ENV: "production", REDIS_URL: "redis://drn-redis:6379" }))).not.toThrow()
  })

  it("test and development may run without Redis (in-memory modules)", () => {
    expect(() => assertRedisForProduction(env({ NODE_ENV: "test" }))).not.toThrow()
    expect(() => assertRedisForProduction(env({ NODE_ENV: "development", REDIS_URL: "" }))).not.toThrow()
    expect(() => assertRedisForProduction(env({}))).not.toThrow()
  })
})
