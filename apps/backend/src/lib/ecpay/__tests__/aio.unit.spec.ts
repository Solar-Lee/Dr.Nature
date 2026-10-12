import {
  buildCheckoutForm,
  buildQueryTradeInfoRequest,
  formatTaipeiDate,
  isPaid,
  newMerchantTradeNo,
  parsePaymentNotice,
  parseTradeInfoResponse,
  toWholeTwd,
} from "../aio"
import { computeCheckMacValue, verifyCheckMacValue } from "../check-mac-value"

// ECPay PUBLIC sandbox merchant (developers.ecpay.com.tw/2856/).
const creds = { merchantId: "3002607", hashKey: "pwFHCqoQZGmho4w6", hashIV: "EkRm7iFT261dpevs" }
const mac = { hashKey: creds.hashKey, hashIV: creds.hashIV, algorithm: "sha256" as const }
const sign = (fields: Record<string, string>) => ({
  ...fields,
  CheckMacValue: computeCheckMacValue(fields, mac),
})

describe("toWholeTwd", () => {
  it("accepts positive whole numbers (number or numeric string)", () => {
    expect(toWholeTwd(1150)).toEqual(1150)
    expect(toWholeTwd("2300")).toEqual(2300)
  })
  it.each([[1150.5], [0], [-1], ["abc"], [NaN], [Infinity], [null]])("rejects %p", (v) => {
    expect(() => toWholeTwd(v)).toThrow()
  })
})

describe("formatTaipeiDate", () => {
  it("renders UTC+8 as yyyy/MM/dd HH:mm:ss, crossing midnight correctly", () => {
    expect(formatTaipeiDate(new Date("2026-10-12T17:05:09Z"))).toEqual("2026/10/13 01:05:09")
    expect(formatTaipeiDate(new Date("2026-12-31T16:00:00Z"))).toEqual("2027/01/01 00:00:00")
  })
})

describe("newMerchantTradeNo", () => {
  it("is exactly 20 letters/digits starting with DN and the Taipei timestamp", () => {
    const no = newMerchantTradeNo(new Date("2026-10-12T17:05:09Z"), new Uint8Array([0, 1, 35, 36, 71, 255]))
    expect(no).toMatch(/^[A-Za-z0-9]{20}$/)
    expect(no.startsWith("DN261013010509")).toBe(true)
  })
  it("differs for different random bytes", () => {
    const d = new Date()
    expect(newMerchantTradeNo(d, new Uint8Array([1, 2, 3, 4, 5, 6]))).not.toEqual(
      newMerchantTradeNo(d, new Uint8Array([6, 5, 4, 3, 2, 1]))
    )
  })
})

describe("buildCheckoutForm", () => {
  const base = {
    credentials: creds,
    environment: "stage" as const,
    merchantTradeNo: "DN2610130105090123AB",
    tradeDate: new Date("2026-10-12T17:05:09Z"),
    totalAmount: 1150,
    itemName: "Dr.Nature 訂單",
    tradeDesc: "Dr.Nature",
    returnUrl: "https://api.example.com/hooks/ecpay/payment",
    orderResultUrl: "https://shop.example.com/checkout/ecpay/result",
    clientBackUrl: "https://shop.example.com/account/orders",
    choosePayment: "Credit" as const,
    customField1: "payses_123",
  }

  it("produces a stage form whose CheckMacValue verifies and which carries no keys", () => {
    const form = buildCheckoutForm(base)
    expect(form.action).toEqual("https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5")
    expect(form.fields).toMatchObject({
      MerchantID: "3002607",
      PaymentType: "aio",
      TotalAmount: "1150",
      EncryptType: "1",
      ChoosePayment: "Credit",
      CustomField1: "payses_123",
      MerchantTradeDate: "2026/10/13 01:05:09",
    })
    expect(verifyCheckMacValue(form.fields, mac)).toBe(true)
    const serialized = JSON.stringify(form)
    expect(serialized).not.toContain(creds.hashKey)
    expect(serialized).not.toContain(creds.hashIV)
  })

  it("truncates ItemName to 400 characters before signing", () => {
    const form = buildCheckoutForm({ ...base, itemName: "x".repeat(500) })
    expect(form.fields.ItemName).toHaveLength(400)
    expect(verifyCheckMacValue(form.fields, mac)).toBe(true)
  })

  it.each([
    ["non-integer amount", { totalAmount: 1150.5 }],
    ["trade no with symbols", { merchantTradeNo: "DN-123" }],
    ["trade no over 20 chars", { merchantTradeNo: "D".repeat(21) }],
    ["unsupported method", { choosePayment: "ATM" as any }],
    ["CustomField1 over 50 chars", { customField1: "x".repeat(51) }],
  ])("rejects %s", (_n, override) => {
    expect(() => buildCheckoutForm({ ...base, ...override })).toThrow()
  })
})

describe("parsePaymentNotice / isPaid", () => {
  const notice = sign({
    MerchantID: "3002607",
    MerchantTradeNo: "DN2610130105090123AB",
    RtnCode: "1",
    RtnMsg: "交易成功",
    TradeNo: "2610130105091234",
    TradeAmt: "1150",
    PaymentType: "Credit_CreditCard",
    PaymentDate: "2026/10/13 01:06:00",
    SimulatePaid: "0",
    CustomField1: "payses_123",
  })

  it("accepts a signed notice from our merchant and binds it to the session", () => {
    const parsed = parsePaymentNotice(notice, creds)
    expect(parsed).not.toBeNull()
    expect(parsed?.sessionId).toEqual("payses_123")
    expect(isPaid(parsed!, 1150)).toBe(true)
  })

  it("rejects a notice whose amount was changed after signing", () => {
    expect(parsePaymentNotice({ ...notice, TradeAmt: "1" }, creds)).toBeNull()
  })

  it("rejects a notice signed for another merchant", () => {
    const other = { ...creds, merchantId: "2000132" }
    expect(parsePaymentNotice(notice, other)).toBeNull()
  })

  it("rejects an unsigned notice", () => {
    const { CheckMacValue: _omit, ...unsigned } = notice
    expect(parsePaymentNotice(unsigned, creds)).toBeNull()
  })

  it("never treats simulated, failed or wrong-amount notices as paid", () => {
    const simulated = parsePaymentNotice(sign({ ...stripMac(notice), SimulatePaid: "1" }), creds)!
    const failed = parsePaymentNotice(sign({ ...stripMac(notice), RtnCode: "10100248" }), creds)!
    expect(isPaid(simulated, 1150)).toBe(false)
    expect(isPaid(failed, 1150)).toBe(false)
    expect(isPaid(parsePaymentNotice(notice, creds)!, 2300)).toBe(false)
  })
})

describe("QueryTradeInfo", () => {
  it("signs the request with MerchantID, MerchantTradeNo and a unix TimeStamp", () => {
    const req = buildQueryTradeInfoRequest(creds, "DN1", new Date("2026-10-13T00:00:00Z"))
    expect(req.TimeStamp).toEqual(String(Date.parse("2026-10-13T00:00:00Z") / 1000))
    expect(verifyCheckMacValue(req, mac)).toBe(true)
  })

  it("parses a signed response and rejects an unsigned or tampered one", () => {
    const fields = sign({
      MerchantID: "3002607",
      MerchantTradeNo: "DN1",
      TradeNo: "T1",
      TradeAmt: "1150",
      TradeStatus: "1",
      PaymentType: "Credit_CreditCard",
    })
    const body = new URLSearchParams(fields).toString()
    expect(parseTradeInfoResponse(body, creds)).toMatchObject({ tradeStatus: "1", tradeAmt: 1150 })
    expect(parseTradeInfoResponse(body.replace("TradeStatus=1", "TradeStatus=0"), creds)).toBeNull()
    expect(parseTradeInfoResponse("TradeStatus=1&TradeAmt=1150", creds)).toBeNull()
  })
})

function stripMac(fields: Record<string, string>) {
  const { CheckMacValue: _omit, ...rest } = fields
  return rest
}
