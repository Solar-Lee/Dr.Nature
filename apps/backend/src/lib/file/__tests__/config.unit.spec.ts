import { fileModuleFromEnv, fileStaticUrl } from "../config"

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv

describe("file module options", () => {
  it("uploads are served from <MEDUSA_BACKEND_URL>/static (trailing slash removed)", () => {
    expect(fileStaticUrl("https://x.example/")).toEqual("https://x.example/static")
    const [mod] = fileModuleFromEnv(env({ MEDUSA_BACKEND_URL: "https://x.example/" }))
    expect(mod.resolve).toEqual("@medusajs/medusa/file")
    expect(mod.options.providers).toEqual([
      { resolve: "@medusajs/medusa/file-local", id: "local", options: { backend_url: "https://x.example/static" } },
    ])
  })

  it("production without MEDUSA_BACKEND_URL refuses to boot", () => {
    expect(() => fileModuleFromEnv(env({ NODE_ENV: "production" }))).toThrow(/MEDUSA_BACKEND_URL is required in production/)
  })

  it("test and development without the URL keep Medusa's defaults (no module entry)", () => {
    expect(fileModuleFromEnv(env({ NODE_ENV: "test" }))).toEqual([])
    expect(fileModuleFromEnv(env({}))).toEqual([])
  })

  it("the provider id is 'local' (file ids are prefixed with it; changing it orphans stored files)", () => {
    const [mod] = fileModuleFromEnv(env({ MEDUSA_BACKEND_URL: "http://localhost:9000" }))
    expect(mod.options.providers[0].id).toEqual("local")
  })
})
