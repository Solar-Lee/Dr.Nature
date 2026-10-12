import {
  buildInvoiceRequest,
  buildIssueData,
  choiceFields,
  decryptInvoiceData,
  encryptInvoiceData,
  invoiceItems,
  parseInvoiceChoice,
  parseInvoiceResponse,
} from "../invoice"

// ECPay PUBLIC e-invoice sandbox merchant (developers.ecpay.com.tw/7849/).
const creds = { merchantId: "2000132", hashKey: "ejCk326UnaZWKisg", hashIV: "q9jcZX8Ib9LM8wYk" }

describe("AES envelope (developers.ecpay.com.tw/7958/ worked example)", () => {
  it("matches the official ciphertext byte for byte", () => {
    expect(encryptInvoiceData({ Name: "Test", ID: "A123456789" }, creds)).toEqual(
      "uvI4yrErM37XNQkXGAgRgJAgHn2t72jahaMZzYhWL1HmvH4WV18VJDP2i9pTbC+tby5nxVExLLFyAkbjbS2Dvg=="
    )
  })

  it("round-trips Chinese text, spaces and plus signs", () => {
    const data = { ItemName: "日日順益生菌 60 顆", CarrierNum: "/AB+1.-C", n: 1150 }
    expect(decryptInvoiceData(encryptInvoiceData(data, creds), creds)).toEqual(data)
  })

  it("decodes ECPay's .NET-style answers (space as +)", () => {
    const { createCipheriv } = require("crypto")
    const c = createCipheriv("aes-128-cbc", Buffer.from(creds.hashKey), Buffer.from(creds.hashIV))
    const enc = Buffer.concat([c.update("%7b%22RtnMsg%22%3a%22%e9%96%8b%e7%ab%8b+%e6%88%90%e5%8a%9f%22%7d", "utf8"), c.final()]).toString("base64")
    expect(decryptInvoiceData(enc, creds)).toEqual({ RtnMsg: "開立 成功" })
  })

  it("refuses keys that are not 16 characters", () => {
    expect(() => encryptInvoiceData({}, { ...creds, hashKey: "short" })).toThrow()
  })
})

describe("request / response", () => {
  it("wraps Data with MerchantID and a Unix-seconds timestamp", () => {
    const r = buildInvoiceRequest(creds, { RelateNumber: "X1" }, new Date("2026-10-13T00:00:00Z"))
    expect(r).toMatchObject({ MerchantID: "2000132", RqHeader: { Timestamp: 1791849600 } })
    expect(decryptInvoiceData(r.Data, creds)).toEqual({ MerchantID: "2000132", RelateNumber: "X1" })
  })

  const answer = (data: unknown, extra: Record<string, unknown> = {}) => ({
    MerchantID: "2000132",
    RpHeader: { Timestamp: 1791849600 },
    TransCode: 1,
    TransMsg: "",
    Data: encryptInvoiceData(data, creds),
    ...extra,
  })

  it("success needs TransCode 1 and RtnCode 1", () => {
    expect(parseInvoiceResponse(answer({ RtnCode: 1, InvoiceNo: "AB12345678" }), creds)).toEqual({
      ok: true,
      data: { RtnCode: 1, InvoiceNo: "AB12345678" },
    })
  })

  it.each([
    ["a business refusal", answer({ RtnCode: 1500019, RtnMsg: "x" }), false],
    ["a transport failure", answer({ RtnCode: 1 }, { TransCode: 999 }), true],
    ["another merchant", answer({ RtnCode: 1 }, { MerchantID: "3002607" }), true],
    ["undecryptable Data", answer({ RtnCode: 1 }, { Data: "AAAAAAAAAAAAAAAAAAAAAA==" }), true],
    ["no body", null, true],
  ])("rejects %s", (_n, body, transport) => {
    expect(parseInvoiceResponse(body, creds)).toMatchObject({ ok: false, transport })
  })
})

describe("buyer's invoice choice (INV-07 / INV-08 formats)", () => {
  it.each([
    [{ type: "member" }, { type: "member" }],
    [{ type: "mobile_barcode", barcode: " /abc+12. " }, { type: "mobile_barcode", barcode: "/ABC+12." }],
    [{ type: "citizen_cert", cert: "ab12345678901234" }, { type: "citizen_cert", cert: "AB12345678901234" }],
    [{ type: "donation", love_code: "168001" }, { type: "donation", love_code: "168001" }],
    [{ type: "company", tax_id: "97025978", title: "綠界科技股份有限公司" }, { type: "company", tax_id: "97025978", title: "綠界科技股份有限公司" }],
  ])("accepts %j", (input, choice) => {
    expect(parseInvoiceChoice(input)).toEqual({ ok: true, choice })
  })

  it.each([
    [{ type: "mobile_barcode", barcode: "ABC1234" }],
    [{ type: "mobile_barcode", barcode: "/ABC12345" }],
    [{ type: "mobile_barcode", barcode: "/AB_1234" }],
    [{ type: "citizen_cert", cert: "A123456789012345" }],
    [{ type: "donation", love_code: "12" }],
    [{ type: "donation", love_code: "12345678" }],
    [{ type: "company", tax_id: "9702597", title: "x" }],
    [{ type: "company", tax_id: "97025978", title: "" }],
    [{ type: "paper" }],
    [null],
  ])("refuses %j with a Chinese reason", (input) => {
    const r = parseInvoiceChoice(input)
    expect(r.ok).toBe(false)
    expect(!r.ok && /[\u4e00-\u9fff]/.test(r.message)).toBe(true)
  })

  it("never asks for paper, and follows ECPay's combination rules", () => {
    for (const c of [
      { type: "member" },
      { type: "mobile_barcode", barcode: "/ABC+123" },
      { type: "citizen_cert", cert: "AB12345678901234" },
      { type: "donation", love_code: "168001" },
      { type: "company", tax_id: "97025978", title: "公司" },
    ] as const) {
      const f = choiceFields(c)
      expect(f.Print).toEqual("0")
      // Donation needs no tax id; a tax id needs a carrier when not printed.
      if (f.Donation === "1") {
        expect([f.CustomerIdentifier, f.CarrierType]).toEqual(["", ""])
      }
      if (f.CustomerIdentifier) {
        expect([f.Donation, f.CarrierType]).toEqual(["0", "1"])
      }
    }
  })
})

describe("issue data", () => {
  it("items add up to SalesAmount exactly, even with discount decimals", () => {
    const items = invoiceItems(
      [
        { title: "日日順益生菌", quantity: 2, total: 2070.4 },
        { title: "晶亮益生菌", quantity: 1, total: 1035.3 },
      ],
      0,
      3106
    )
    expect(items.reduce((s, i) => s + i.ItemAmount, 0)).toEqual(3106)
    expect(items.map((i) => i.ItemSeq)).toEqual([1, 2])
  })

  it("adds shipping as its own line when charged", () => {
    const items = invoiceItems([{ title: "A", quantity: 1, total: 1150 }], 60, 1210)
    expect(items.map((i) => [i.ItemName, i.ItemAmount])).toEqual([["A", 1150], ["運費", 60]])
  })

  it("builds a member-carrier invoice for the order", () => {
    const d = buildIssueData({
      relateNumber: "01K7ABCDEF0123456789ABCDEF",
      email: "buyer@drn.test",
      choice: { type: "member" },
      salesAmount: 1150,
      lines: [{ title: "日日順益生菌", quantity: 1, total: 1150 }],
      shippingTotal: 0,
    })
    expect(d).toMatchObject({
      RelateNumber: "01K7ABCDEF0123456789ABCDEF",
      CustomerEmail: "buyer@drn.test",
      Print: "0",
      Donation: "0",
      CarrierType: "1",
      TaxType: "1",
      SalesAmount: 1150,
      InvType: "07",
      vat: "1",
      Items: [{ ItemSeq: 1, ItemName: "日日順益生菌", ItemCount: 1, ItemWord: "件", ItemPrice: 1150, ItemTaxType: "1", ItemAmount: 1150 }],
    })
  })

  it.each([
    ["a RelateNumber with symbols", { relateNumber: "order_01K7" }],
    ["a zero amount", { salesAmount: 0 }],
    ["a decimal amount", { salesAmount: 1150.5 }],
    ["no e-mail", { email: " " }],
  ])("refuses %s", (_n, o) => {
    const base = { relateNumber: "R1", email: "b@drn.test", choice: { type: "member" as const }, salesAmount: 1150, lines: [{ title: "A", quantity: 1, total: 1150 }], shippingTotal: 0 }
    expect(() => buildIssueData({ ...base, ...o })).toThrow()
  })
})
