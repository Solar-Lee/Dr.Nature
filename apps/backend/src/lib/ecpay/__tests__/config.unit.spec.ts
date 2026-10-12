import { ecpayOptionsFromEnv } from "../config"

const base = {
  ECPAY_ENV: "stage",
  ECPAY_MERCHANT_ID: "3002607",
  ECPAY_HASH_KEY: "pwFHCqoQZGmho4w6",
  ECPAY_HASH_IV: "EkRm7iFT261dpevs",
  MEDUSA_BACKEND_URL: "https://api.dr.nature.smilelife.tw/",
  STOREFRONT_URL: "https://dr.nature.smilelife.tw",
}

describe("ecpayOptionsFromEnv", () => {
  it("derives ECPay URLs from the backend and storefront URLs", () => {
    const o = ecpayOptionsFromEnv(base)
    expect(o.returnUrl).toEqual("https://api.dr.nature.smilelife.tw/hooks/ecpay/payment")
    expect(o.orderResultUrl).toEqual("https://dr.nature.smilelife.tw/checkout/ecpay/result")
    expect(o.clientBackUrl).toEqual("https://dr.nature.smilelife.tw/account/orders")
    expect(o.checkoutUrl).toEqual("https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5")
    expect(o.queryTradeInfoUrl).toEqual("https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5")
  })

  it("uses production hosts for prod", () => {
    const o = ecpayOptionsFromEnv({ ...base, ECPAY_ENV: "prod" })
    expect(o.checkoutUrl).toEqual("https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5")
    expect(o.queryTradeInfoUrl).toEqual("https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5")
  })

  it("honours the QueryTradeInfo override outside prod only", () => {
    expect(ecpayOptionsFromEnv({ ...base, ECPAY_API_BASE_URL: "http://127.0.0.1:56390/" }).queryTradeInfoUrl).toEqual(
      "http://127.0.0.1:56390/Cashier/QueryTradeInfo/V5"
    )
    expect(() => ecpayOptionsFromEnv({ ...base, ECPAY_ENV: "prod", ECPAY_API_BASE_URL: "http://x" })).toThrow()
  })

  it.each(["ECPAY_ENV", "ECPAY_MERCHANT_ID", "ECPAY_HASH_KEY", "ECPAY_HASH_IV", "MEDUSA_BACKEND_URL", "STOREFRONT_URL"])(
    "requires %s",
    (name) => {
      const env: Record<string, string> = { ...base }
      delete env[name]
      expect(() => ecpayOptionsFromEnv(env)).toThrow(name)
    }
  )

  it("rejects an unknown ECPAY_ENV", () => {
    expect(() => ecpayOptionsFromEnv({ ...base, ECPAY_ENV: "production" })).toThrow()
  })
})
