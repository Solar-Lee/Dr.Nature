import {
  autoSubmitHtml,
  buildCancelC2COrderRequest,
  buildCreateShipmentRequest,
  buildMapForm,
  buildPrintForm,
  buildQueryLogisticsTradeInfoRequest,
  buildUpdateStoreInfoRequest,
  displayWidth,
  isOkReply,
  nameProblem,
  newLogisticsTradeNo,
  normalizeCellphone,
  parseChosenStore,
  parseCreateShipmentResponse,
  parseLogisticsNotice,
  parseLogisticsTradeInfo,
  receiverEmail,
  receiverProblem,
  shipmentCode,
  statusMeaning,
  statusNeedsAttention,
} from "../logistics"
import { computeCheckMacValue, verifyCheckMacValue } from "../check-mac-value"

// ECPay PUBLIC C2C logistics sandbox merchant (developers.ecpay.com.tw/7398/).
const creds = { merchantId: "2000933", hashKey: "XBERn1YOvpM9nfZc", hashIV: "h1ONHk4P4yqbl5LK" }
const md5 = { hashKey: creds.hashKey, hashIV: creds.hashIV, algorithm: "md5" as const }
const signMd5 = (f: Record<string, string>) => ({ ...f, CheckMacValue: computeCheckMacValue(f, md5) })

describe("e-map form", () => {
  it("posts to the stage map without a CheckMacValue", () => {
    const f = buildMapForm({
      credentials: creds,
      environment: "stage",
      subtype: "UNIMARTC2C",
      serverReplyUrl: "https://shop.example.com/checkout/ecpay/cvs-store",
      isMobile: true,
      extraData: "cart123",
    })
    expect(f.action).toEqual("https://logistics-stage.ecpay.com.tw/Express/map")
    expect(f.fields).toEqual({
      MerchantID: "2000933",
      LogisticsType: "CVS",
      LogisticsSubType: "UNIMARTC2C",
      IsCollection: "N",
      ServerReplyURL: "https://shop.example.com/checkout/ecpay/cvs-store",
      ExtraData: "cart123",
      Device: "1",
    })
  })

  it("rejects ExtraData over 20 characters", () => {
    expect(() =>
      buildMapForm({ credentials: creds, environment: "stage", subtype: "FAMIC2C", serverReplyUrl: "x", isMobile: false, extraData: "x".repeat(21) })
    ).toThrow()
  })
})

describe("parseChosenStore (unsigned e-map callback)", () => {
  // Field names as ECPay posts them; values from the real stage map (2026-10-13).
  const sevenEleven = { LogisticsSubType: "UNIMARTC2C", CVSStoreID: "238669", CVSStoreName: "經貿", CVSAddress: "台北市南港區三重路19號1樓", CVSOutSide: "0" }

  it("accepts ECPay's field names and normalises them", () => {
    expect(parseChosenStore(sevenEleven, "UNIMARTC2C")).toEqual({
      subtype: "UNIMARTC2C",
      store_id: "238669",
      store_name: "經貿",
      store_address: "台北市南港區三重路19號1樓",
      outlying_island: false,
    })
  })

  it("accepts already-normalised data (re-validation)", () => {
    const stored = parseChosenStore(sevenEleven, "UNIMARTC2C")
    expect(parseChosenStore(stored as any, "UNIMARTC2C")).toEqual(stored)
  })

  it.each([
    ["a store for another carrier", { ...sevenEleven, LogisticsSubType: "FAMIC2C" }],
    ["a store id with symbols", { ...sevenEleven, CVSStoreID: "23866'9" }],
    ["a store id longer than 6", { ...sevenEleven, CVSStoreID: "2386690" }],
    ["a missing address", { ...sevenEleven, CVSAddress: "" }],
    ["an over-long store name", { ...sevenEleven, CVSStoreName: "超".repeat(11) }],
  ])("rejects %s", (_n, data) => {
    expect(() => parseChosenStore(data, "UNIMARTC2C")).toThrow()
  })
})

describe("receiver / sender rules", () => {
  it.each([["王小明", null], ["歐陽小明", null], ["John Lee", null]])("accepts %s", (n, expected) => {
    expect(nameProblem(n)).toEqual(expected)
  })
  it.each(["王", "王小明王小明", "王小明2", "Jo", "王小明😀", "王-小明"])("rejects %s", (n) => {
    expect(nameProblem(n)).not.toBeNull()
  })
  it("counts CJK as width 2", () => {
    expect(displayWidth("Dr.Nature 保健食品")).toEqual(18)
  })
  it.each([
    ["0912345678", "0912345678"],
    ["0912-345-678", "0912345678"],
    ["+886912345678", "0912345678"],
    ["0212345678", null],
    ["091234567", null],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeCellphone(input)).toEqual(expected)
  })
})

describe("buildCreateShipmentRequest", () => {
  const base = {
    credentials: creds,
    merchantTradeNo: "DL2610130105090123AB",
    tradeDate: new Date("2026-10-12T17:05:09Z"),
    goodsAmount: 1150,
    goodsName: "Dr.Nature 保健食品",
    sender: { name: "王小明", cellphone: "0912345678" },
    receiver: { name: "陳小華", cellphone: "0987-654-321" },
    serverReplyUrl: "https://api.example.com/hooks/ecpay/logistics",
  }

  it("C2C CVS: MD5-signed, prepaid, store and parties normalised", () => {
    const f = buildCreateShipmentRequest({ ...base, type: "CVS", subtype: "UNIMARTC2C", storeId: "238669" })
    expect(f).toMatchObject({
      MerchantID: "2000933",
      LogisticsType: "CVS",
      LogisticsSubType: "UNIMARTC2C",
      IsCollection: "N",
      GoodsAmount: "1150",
      ReceiverStoreID: "238669",
      ReceiverCellPhone: "0987654321",
      SenderCellPhone: "0912345678",
      MerchantTradeDate: "2026/10/13 01:05:09",
    })
    expect(verifyCheckMacValue(f, md5)).toBe(true)
    expect(verifyCheckMacValue(f, { ...md5, algorithm: "sha256" })).toBe(false)
  })

  it("HOME (TCAT): addresses, ambient, 60cm, any time", () => {
    const f = buildCreateShipmentRequest({
      ...base,
      type: "HOME",
      subtype: "TCAT",
      senderZip: "115",
      senderAddress: "台北市南港區三重路19號",
      receiverZip: "110",
      receiverAddress: "台北市信義區信義路五段7號",
    })
    expect(f).toMatchObject({ LogisticsType: "HOME", LogisticsSubType: "TCAT", Temperature: "0001", Specification: "0001", ScheduledPickupTime: "4" })
    expect(f.ReceiverStoreID).toBeUndefined()
  })

  it.each([
    ["GoodsAmount over 20000 (ECPay error 10500040)", { goodsAmount: 20001 }],
    ["non-integer GoodsAmount", { goodsAmount: 1150.5 }],
    ["a receiver name with digits", { receiver: { name: "陳小華2", cellphone: "0987654321" } }],
    ["a landline as cellphone", { receiver: { name: "陳小華", cellphone: "0223456789" } }],
    ["a banned GoodsName character", { goodsName: "Dr.Nature #1" }],
    ["a long trade number", { merchantTradeNo: "D".repeat(21) }],
  ])("rejects %s", (_n, o) => {
    expect(() => buildCreateShipmentRequest({ ...base, ...o, type: "CVS", subtype: "UNIMARTC2C", storeId: "238669" } as any)).toThrow()
  })
})

describe("parseCreateShipmentResponse", () => {
  const fields = {
    AllPayLogisticsID: "3690131",
    BookingNote: "",
    CVSPaymentNo: "D8844527",
    CVSValidationNo: "4471",
    GoodsAmount: "1150",
    LogisticsSubType: "UNIMARTC2C",
    LogisticsType: "CVS",
    MerchantID: "2000933",
    MerchantTradeNo: "DL2610130105090123AB",
    RtnCode: "300",
    RtnMsg: "訂單處理中(綠界已收到訂單資料)",
  }
  const body = (f: Record<string, string>) => `1|${new URLSearchParams(signMd5(f)).toString()}`

  const TRADE = fields.MerchantTradeNo

  it("parses a signed success answer (shape seen from real stage)", () => {
    const r = parseCreateShipmentResponse(body(fields), creds, TRADE)
    expect(r).toEqual({ ok: true, fields: expect.objectContaining({ AllPayLogisticsID: "3690131", CVSPaymentNo: "D8844527", CVSValidationNo: "4471" }) })
  })

  it("an explicit ECPay refusal is certain: no shipment exists", () => {
    expect(parseCreateShipmentResponse("0|ReceiverName格式錯誤", creds, TRADE)).toEqual({ ok: false, message: "ReceiverName格式錯誤", uncertain: false })
  })

  it.each([
    ["a tampered success", body(fields).replace("CVSPaymentNo=D8844527", "CVSPaymentNo=X0000000")],
    ["an unsigned success", `1|${new URLSearchParams(fields).toString()}`],
    ["another merchant's answer", body({ ...fields, MerchantID: "2000132" })],
    ["an answer for another trade", body({ ...fields, MerchantTradeNo: "DL2610130105090123XX" })],
    ["a success without a shipment id", body({ ...fields, AllPayLogisticsID: "" })],
    ["a non-ECPay body", "<html>502</html>"],
  ])("rejects %s as uncertain (ECPay may have created it)", (_n, b) => {
    expect(parseCreateShipmentResponse(b, creds, TRADE)).toMatchObject({ ok: false, uncertain: true })
  })
})

describe("QueryLogisticsTradeInfo (shape verified on real stage 2026-10-13)", () => {
  it("signs the request with a unix timestamp and an empty PlatformID", () => {
    const r = buildQueryLogisticsTradeInfoRequest(creds, "DL2610130105090123AB", new Date("2026-10-13T00:00:00Z"))
    expect(r).toMatchObject({ MerchantID: "2000933", MerchantTradeNo: "DL2610130105090123AB", TimeStamp: "1791849600", PlatformID: "" })
    expect(verifyCheckMacValue(r, md5)).toBe(true)
  })

  const answer = signMd5({
    AllPayLogisticsID: "3690131",
    CVSPaymentNo: "D8844527",
    CVSValidationNo: "4471",
    LogisticsStatus: "300",
    MerchantID: "2000933",
    MerchantTradeNo: "DL2610130105090123AB",
  })

  it("accepts only a signed answer for this merchant's trade", () => {
    const q = (o: Record<string, string>) => new URLSearchParams(o).toString()
    expect(parseLogisticsTradeInfo(q(answer), creds, "DL2610130105090123AB")?.AllPayLogisticsID).toEqual("3690131")
    expect(parseLogisticsTradeInfo(q({ ...answer, LogisticsStatus: "2067" }), creds, "DL2610130105090123AB")).toBeNull()
    expect(parseLogisticsTradeInfo(q(answer), creds, "DL2610130105090123XX")).toBeNull()
    expect(parseLogisticsTradeInfo("0|找不到訂單", creds, "DL2610130105090123AB")).toBeNull()
  })
})

describe("shipment code and receiver checks", () => {
  it("7-ELEVEN code is CVSPaymentNo + CVSValidationNo; others use what they have", () => {
    expect(shipmentCode({ CVSPaymentNo: "D8844528", CVSValidationNo: "4456", AllPayLogisticsID: "1" })).toEqual("D88445284456")
    expect(shipmentCode({ CVSPaymentNo: "20155540869", CVSValidationNo: "", AllPayLogisticsID: "1" })).toEqual("20155540869")
    expect(shipmentCode({ BookingNote: "9010000000", AllPayLogisticsID: "1" })).toEqual("9010000000")
  })

  it.each([
    ["buyer@drn.test", "buyer@drn.test"],
    ["  buyer@drn.test ", "buyer@drn.test"],
    [`${"a".repeat(45)}@x.tw`, `${"a".repeat(45)}@x.tw`], // exactly 50
    [`${"a".repeat(46)}@x.tw`, undefined], // 51
    ["not-an-email", undefined],
    [undefined, undefined],
  ])("ReceiverEmail %s -> %s", (input, out) => {
    expect(receiverEmail(input)).toEqual(out)
  })

  it("explains in Chinese why ECPay would refuse a receiver", () => {
    const ok = { country_code: "tw", phone: "0987-654-321", first_name: "小華", last_name: "陳" }
    expect(receiverProblem(ok)).toBeNull()
    expect(receiverProblem({ ...ok, country_code: "jp" })).toContain("台灣")
    expect(receiverProblem({ ...ok, phone: "02-2345-6789" })).toContain("手機")
    expect(receiverProblem({ ...ok, first_name: "User1", last_name: "" })).toContain("姓名")
    expect(receiverProblem(null)).toContain("台灣")
  })
})

describe("status notices", () => {
  const notice = signMd5({
    MerchantID: "2000933",
    MerchantTradeNo: "DL2610130105090123AB",
    RtnCode: "2067",
    RtnMsg: "買家已到店取貨",
    AllPayLogisticsID: "3690131",
    LogisticsType: "CVS",
    LogisticsSubType: "UNIMARTC2C",
    GoodsAmount: "1150",
    UpdateStatusDate: "2026/10/15 18:30:00",
    CVSPaymentNo: "D8844527",
    CVSValidationNo: "4471",
  })

  it("verifies the MD5 signature and merchant", () => {
    expect(parseLogisticsNotice(notice, creds)?.allPayLogisticsId).toEqual("3690131")
    expect(parseLogisticsNotice({ ...notice, RtnCode: "2074" }, creds)).toBeNull()
    expect(parseLogisticsNotice(notice, { ...creds, merchantId: "2000132" })).toBeNull()
  })

  it.each([
    ["2068", "shipped"],
    ["3032", "shipped"],
    ["2073", "arrived"],
    ["3018", "arrived"],
    ["3029", "arrived"],
    ["2067", "delivered"],
    ["3022", "delivered"],
    ["2074", "returning"],
    ["3019", "returning"],
    ["2104", "reselect_store"],
    ["2037", "reselect_store"],
    ["7032", "reselect_store"],
    ["7035", "lost"],
    ["9999", "canceled"],
    ["300", "progress"],
    ["2001", "progress"],
    ["7013", "attention"], // 訂單超過驗收期限（賣家未出貨）
    ["123456", "attention"], // any code we do not know
  ])("maps %s to %s", (code, meaning) => {
    expect(statusMeaning(code)).toEqual(meaning)
  })

  it("alerts on everything except normal progress", () => {
    expect(["progress", "shipped", "arrived", "delivered"].map((m) => statusNeedsAttention(m as never))).toEqual([false, false, false, false])
    expect(["reselect_store", "returning", "lost", "canceled", "attention"].map((m) => statusNeedsAttention(m as never))).toEqual([true, true, true, true, true])
  })
})

it("logistics trade numbers are 20 letters/digits with a DL prefix", () => {
  expect(newLogisticsTradeNo(new Date("2026-10-12T17:05:09Z"), new Uint8Array([1, 2, 3, 4, 5, 6]))).toMatch(
    /^DL261013010509[0-9A-Z]{6}$/
  )
})

describe("after shipment (P4-11)", () => {
  const ship = { allPayLogisticsId: "2669087", cvsPaymentNo: "D8844527", cvsValidationNo: "4471" }

  it("UpdateStoreInfo names the store field by StoreType and is signed", () => {
    const pickup = buildUpdateStoreInfoRequest(creds, { ...ship, storeType: "01", storeId: "131386" })
    expect(pickup).toMatchObject({ StoreType: "01", ReceiverStoreID: "131386", CVSValidationNo: "4471" })
    expect(pickup.ReturnStoreID).toBeUndefined()
    expect(verifyCheckMacValue(pickup, md5)).toBe(true)
    const ret = buildUpdateStoreInfoRequest(creds, { ...ship, storeType: "02", storeId: "991182" })
    expect(ret).toMatchObject({ StoreType: "02", ReturnStoreID: "991182" })
    expect(ret.ReceiverStoreID).toBeUndefined()
  })

  it("UpdateStoreInfo refuses a blank or over-long store code", () => {
    for (const storeId of ["", " ", "1234567", "13-386"]) {
      expect(() => buildUpdateStoreInfoRequest(creds, { ...ship, storeType: "02", storeId })).toThrow(/store id/)
    }
  })

  it("CancelC2COrder carries all three 7-ELEVEN codes and is signed", () => {
    const f = buildCancelC2COrderRequest(creds, ship)
    expect(f).toMatchObject({ MerchantID: "2000933", AllPayLogisticsID: "2669087", CVSPaymentNo: "D8844527", CVSValidationNo: "4471" })
    expect(verifyCheckMacValue(f, md5)).toBe(true)
  })

  it("only an exact 1|OK counts as success", () => {
    expect(isOkReply("1|OK")).toBe(true)
    expect(isOkReply("1|OK\r\n")).toBe(true)
    expect(isOkReply("0|新取貨門市代碼與舊取貨門市代碼相同。")).toBe(false)
    expect(isOkReply("1|OKAY")).toBe(false)
  })

  it("print form: per-carrier path; validation code and thermal mode only for 7-ELEVEN", () => {
    const seven = buildPrintForm(creds, "stage", "UNIMARTC2C", [ship], "2")
    expect(seven.action).toBe("https://logistics-stage.ecpay.com.tw/Express/PrintUniMartC2COrderInfo")
    expect(seven.fields).toMatchObject({ CVSValidationNo: "4471", PrintMode: "2" })
    expect(verifyCheckMacValue(seven.fields, md5)).toBe(true)
    const fami = buildPrintForm(creds, "stage", "FAMIC2C", [{ allPayLogisticsId: "1", cvsPaymentNo: "2" }], "2")
    expect(fami.action).toMatch(/PrintFAMIC2COrderInfo$/)
    expect(fami.fields.PrintMode).toBeUndefined()
    expect(fami.fields.CVSValidationNo).toBeUndefined()
    expect(() => buildPrintForm(creds, "stage", "UNIMART", [ship])).toThrow(/no C2C slip printing/)
  })

  it("the auto-submit page escapes values and never carries the HashKey", () => {
    const html = autoSubmitHtml({ action: "https://x/y", fields: { A: '"><script>' } })
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;"')
    expect(html).not.toContain(creds.hashKey)
  })
})
