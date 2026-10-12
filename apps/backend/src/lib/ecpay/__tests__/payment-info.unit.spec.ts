import {
  PAYMENT_DEADLINES,
  buildCheckoutForm,
  isCodeIssued,
  isPaid,
  parsePaymentInfoNotice,
  parsePaymentNotice,
  paymentDeadlineIso,
  verifiedPaymentInfoFor,
} from "../aio"
import { computeCheckMacValue, verifyCheckMacValue } from "../check-mac-value"

// ECPay PUBLIC sandbox merchant (developers.ecpay.com.tw/2856/).
const creds = { merchantId: "3002607", hashKey: "pwFHCqoQZGmho4w6", hashIV: "EkRm7iFT261dpevs" }
const mac = { hashKey: creds.hashKey, hashIV: creds.hashIV, algorithm: "sha256" as const }
const sign = (f: Record<string, string>) => ({ ...f, CheckMacValue: computeCheckMacValue(f, mac) })

const formBase = {
  credentials: creds,
  environment: "stage" as const,
  merchantTradeNo: "DN2610130105090123AB",
  tradeDate: new Date("2026-10-12T17:05:09Z"),
  totalAmount: 1150,
  itemName: "Dr.Nature 訂單",
  tradeDesc: "Dr.Nature",
  returnUrl: "https://api.example.com/hooks/ecpay/payment",
  customField1: "payses_1",
  paymentInfoUrl: "https://api.example.com/hooks/ecpay/payment-info",
}

describe("checkout form for offline methods", () => {
  it("ATM: ExpireDate in days + PaymentInfoURL", () => {
    const f = buildCheckoutForm({ ...formBase, choosePayment: "ATM" }).fields
    expect(f).toMatchObject({ ChoosePayment: "ATM", ExpireDate: String(PAYMENT_DEADLINES.atmDays), PaymentInfoURL: formBase.paymentInfoUrl })
    expect(f.StoreExpireDate).toBeUndefined()
    expect(verifyCheckMacValue(f, mac)).toBe(true)
  })

  it("CVS: StoreExpireDate in minutes", () => {
    const f = buildCheckoutForm({ ...formBase, choosePayment: "CVS" }).fields
    expect(f).toMatchObject({ ChoosePayment: "CVS", StoreExpireDate: String(PAYMENT_DEADLINES.cvsMinutes) })
    expect(f.ExpireDate).toBeUndefined()
  })

  it("BARCODE: StoreExpireDate in days", () => {
    const f = buildCheckoutForm({ ...formBase, choosePayment: "BARCODE" }).fields
    expect(f).toMatchObject({ ChoosePayment: "BARCODE", StoreExpireDate: String(PAYMENT_DEADLINES.barcodeDays) })
  })

  it.each(["ATM", "CVS", "BARCODE"] as const)("%s omits OrderResultURL (unsupported by ECPay for codes)", (m) => {
    const f = buildCheckoutForm({ ...formBase, choosePayment: m, orderResultUrl: "https://shop.example.com/r" }).fields
    expect(f.OrderResultURL).toBeUndefined()
  })

  it("Credit keeps OrderResultURL", () => {
    const f = buildCheckoutForm({ ...formBase, choosePayment: "Credit", orderResultUrl: "https://shop.example.com/r" }).fields
    expect(f.OrderResultURL).toEqual("https://shop.example.com/r")
  })

  it("Credit carries no PaymentInfoURL or deadline", () => {
    const f = buildCheckoutForm({ ...formBase, choosePayment: "Credit" }).fields
    expect(f.PaymentInfoURL).toBeUndefined()
    expect(f.ExpireDate).toBeUndefined()
    expect(f.StoreExpireDate).toBeUndefined()
  })

  it.each([
    ["ATM without PaymentInfoURL", { choosePayment: "ATM" as const, paymentInfoUrl: undefined }],
    ["ATM 61 days", { choosePayment: "ATM" as const, deadlines: { ...PAYMENT_DEADLINES, atmDays: 61 } }],
    ["CVS over 30 days of minutes", { choosePayment: "CVS" as const, deadlines: { ...PAYMENT_DEADLINES, cvsMinutes: 43201 } }],
    ["BARCODE 31 days", { choosePayment: "BARCODE" as const, deadlines: { ...PAYMENT_DEADLINES, barcodeDays: 31 } }],
  ])("rejects %s", (_n, o) => {
    expect(() => buildCheckoutForm({ ...formBase, ...o })).toThrow()
  })
})

const atmInfo = (o: Record<string, string> = {}) =>
  sign({
    MerchantID: "3002607",
    MerchantTradeNo: "DN2610130105090123AB",
    RtnCode: "2",
    RtnMsg: "Get VirtualAccount Succeeded",
    TradeNo: "2610130105091234",
    TradeAmt: "1150",
    PaymentType: "ATM_FIRST",
    TradeDate: "2026/10/13 01:05:09",
    BankCode: "007",
    vAccount: "9103522175887271",
    ExpireDate: "2026/10/16",
    CustomField1: "payses_1",
    ...o,
  })

const cvsInfo = (o: Record<string, string> = {}) =>
  sign({
    MerchantID: "3002607",
    MerchantTradeNo: "DN2610130105090123AB",
    RtnCode: "10100073",
    RtnMsg: "Get CVS Code Succeeded.",
    TradeNo: "2610130105091234",
    TradeAmt: "1150",
    PaymentType: "CVS_CVS",
    TradeDate: "2026/10/13 01:05:09",
    PaymentNo: "LLL22251222",
    ExpireDate: "2026/10/20 01:05:09",
    CustomField1: "payses_1",
    ...o,
  })

describe("PaymentInfoURL notices", () => {
  it("accepts a signed ATM code (RtnCode 2) with bank code and virtual account", () => {
    const info = parsePaymentInfoNotice(atmInfo(), creds)!
    expect(info).toMatchObject({ bankCode: "007", vAccount: "9103522175887271", expireDate: "2026/10/16" })
    expect(isCodeIssued(info)).toBe(true)
  })

  it("accepts a signed CVS code (RtnCode 10100073)", () => {
    const info = parsePaymentInfoNotice(cvsInfo(), creds)!
    expect(info.paymentNo).toEqual("LLL22251222")
    expect(isCodeIssued(info)).toBe(true)
  })

  it("accepts a signed BARCODE (three segments)", () => {
    const info = parsePaymentInfoNotice(
      sign({ ...stripMac(cvsInfo()), PaymentType: "BARCODE_BARCODE", PaymentNo: "", Barcode1: "151020601", Barcode2: "1234567890123456", Barcode3: "102001000001150" }),
      creds
    )!
    expect(info.barcodes).toEqual(["151020601", "1234567890123456", "102001000001150"])
    expect(isCodeIssued(info)).toBe(true)
  })

  it.each([
    ["ATM with the CVS success code", () => atmInfo({ RtnCode: "10100073" })],
    ["CVS with RtnCode 1 (that is a payment code, not issue)", () => cvsInfo({ RtnCode: "1" })],
    ["ATM without a virtual account", () => atmInfo({ vAccount: "" })],
    ["CVS failure code", () => cvsInfo({ RtnCode: "10100058" })],
  ])("does not treat %s as issued", (_n, body) => {
    expect(isCodeIssued(parsePaymentInfoNotice(body(), creds)!)).toBe(false)
  })

  it("rejects tampered or foreign-merchant notices", () => {
    expect(parsePaymentInfoNotice({ ...atmInfo(), vAccount: "0000000000000000" }, creds)).toBeNull()
    expect(parsePaymentInfoNotice(atmInfo(), { ...creds, merchantId: "2000132" })).toBeNull()
  })

  it("binds the code to the session, trade and amount", () => {
    const binding = { merchantTradeNo: "DN2610130105090123AB", sessionId: "payses_1", amount: 1150 }
    expect(verifiedPaymentInfoFor(atmInfo(), binding, creds)).not.toBeNull()
    expect(verifiedPaymentInfoFor(atmInfo({ CustomField1: "payses_2" }), binding, creds)).toBeNull()
    expect(verifiedPaymentInfoFor(atmInfo({ TradeAmt: "1" }), binding, creds)).toBeNull()
    expect(verifiedPaymentInfoFor(atmInfo({ MerchantTradeNo: "DNOTHER0000000000000" }), binding, creds)).toBeNull()
  })
})

describe("paymentDeadlineIso (Taipei local -> UTC)", () => {
  it("date-only ATM deadline means the end of that day", () => {
    expect(paymentDeadlineIso("2026/10/16")).toEqual("2026-10-16T15:59:59.000Z")
  })
  it("CVS deadline with a time", () => {
    expect(paymentDeadlineIso("2026/10/20 01:05:09")).toEqual("2026-10-19T17:05:09.000Z")
  })
  it("returns null for garbage", () => {
    expect(paymentDeadlineIso("16/10/2026")).toBeNull()
  })
})

describe("simulated payments", () => {
  const paid = parsePaymentNotice(
    sign({ MerchantID: "3002607", MerchantTradeNo: "DN1", RtnCode: "1", TradeAmt: "1150", SimulatePaid: "1", CustomField1: "payses_1" }),
    creds
  )!
  it("never count by default", () => {
    expect(isPaid(paid, 1150)).toBe(false)
  })
  it("count only when explicitly allowed (stage testing)", () => {
    expect(isPaid(paid, 1150, true)).toBe(true)
  })
})

function stripMac(f: Record<string, string>) {
  const { CheckMacValue: _omit, ...rest } = f
  return rest
}
