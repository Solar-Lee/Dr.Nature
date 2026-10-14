import { assertPublicSandboxDrill } from "../public-drill-guard"

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv
const GOOD = {
  ECPAY_ENV: "stage",
  ECPAY_MERCHANT_ID: "3002607",
  ECPAY_LOGISTICS_MERCHANT_ID: "2000933",
  MEDUSA_BACKEND_URL: "https://drn-api.example.tw",
}

describe("public sandbox drill guard", () => {
  it("public stage merchants behind a public https URL -> allowed", () => {
    expect(() => assertPublicSandboxDrill(env(GOOD))).not.toThrow()
  })

  it("prod -> refused", () => {
    expect(() => assertPublicSandboxDrill(env({ ...GOOD, ECPAY_ENV: "prod" }))).toThrow(/ECPAY_ENV must be stage/)
    expect(() => assertPublicSandboxDrill(env({ ...GOOD, ECPAY_ENV: "" }))).toThrow(/ECPAY_ENV must be stage/)
  })

  it("a payment merchant other than the public sandbox 3002607 -> refused", () => {
    expect(() => assertPublicSandboxDrill(env({ ...GOOD, ECPAY_MERCHANT_ID: "3002608" }))).toThrow(/ECPAY_MERCHANT_ID/)
  })

  it("a logistics merchant other than the public C2C sandbox 2000933 -> refused", () => {
    expect(() => assertPublicSandboxDrill(env({ ...GOOD, ECPAY_LOGISTICS_MERCHANT_ID: "2000132" }))).toThrow(/ECPAY_LOGISTICS_MERCHANT_ID/)
  })

  it("a backend URL that is not https -> refused", () => {
    for (const url of ["http://drn-api.example.tw", "http://127.0.0.1:9000", "", "https:/broken"]) {
      expect(() => assertPublicSandboxDrill(env({ ...GOOD, MEDUSA_BACKEND_URL: url }))).toThrow(/MEDUSA_BACKEND_URL must be a public https/)
    }
  })
})
