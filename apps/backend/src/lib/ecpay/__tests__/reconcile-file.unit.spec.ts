import { buildTradeNoAioRequest, parseTradeNoAioCsv } from "../reconcile-file"
import { verifyCheckMacValue } from "../check-mac-value"

// Header and rows exactly as real ECPay stage returned them on 2026-10-13 (V1, UTF-8 + BOM).
const HEADER = "﻿交易日期,綠界交易序號,特店訂單編號,ATM條碼,交易金額,付款方式,付款結果,付款日期,款項來源(銀行/超商),通路費,交易服務費率(%數 / $筆),交易服務費金額,應收款項(淨額),撥款狀態,撥款日期,備註,交易處理費"
const ROW1 = '2026-10-13 04:52:31,2610130452316939,N6bf35797c9af24659bc,="",1200,信用卡,已付款,2026-10-13 04:54:07,信用卡_MasterCard_JCB_VISA,0,2.4500%,30.40,1169.60,未撥款,,-,1.00,'
const ROW2 = '2026-10-13 04:36:38,2610130436386938,BG4348B718CFA78AEACC,="",18500,信用卡分期,已付款,2026-10-13 04:38:01,信用卡分期,0,2.5%,463.50,18036.50,未撥款,,-,1.00,'
const creds = { merchantId: "3002607", hashKey: "pwFHCqoQZGmho4w6", hashIV: "EkRm7iFT261dpevs" }

describe("TradeNoAio (developers.ecpay.com.tw/2896/)", () => {
  it("parses the real stage layout (BOM, Excel-quoted ATM column, trailing comma)", () => {
    const f = parseTradeNoAioCsv([HEADER, ROW1, ROW2].join("\r\n"))
    expect(f).toEqual({
      ok: true,
      rows: [
        { tradeDate: "2026-10-13 04:52:31", tradeNo: "2610130452316939", merchantTradeNo: "N6bf35797c9af24659bc", amount: 1200, paymentMethod: "信用卡", paymentResult: "已付款", paymentDate: "2026-10-13 04:54:07" },
        { tradeDate: "2026-10-13 04:36:38", tradeNo: "2610130436386938", merchantTradeNo: "BG4348B718CFA78AEACC", amount: 18500, paymentMethod: "信用卡分期", paymentResult: "已付款", paymentDate: "2026-10-13 04:38:01" },
      ],
    })
  })

  it("an empty day is just the header", () => {
    expect(parseTradeNoAioCsv(HEADER)).toEqual({ ok: true, rows: [] })
  })

  it("reports ECPay's error row (seen on stage: one file per minute)", () => {
    expect(parseTradeNoAioCsv([HEADER, ",,,,,,,,,,,,,,,一分鐘之內僅限下載一個媒體檔,"].join("\r\n"))).toEqual({ ok: false, message: "一分鐘之內僅限下載一個媒體檔" })
  })

  it("refuses an unexpected layout instead of guessing columns", () => {
    expect(parseTradeNoAioCsv("a,b,c\r\n1,2,3")).toMatchObject({ ok: false })
    expect(parseTradeNoAioCsv("")).toMatchObject({ ok: false })
  })

  it("signs the request (SHA256) with UTF-8 and the chosen format", () => {
    const r = buildTradeNoAioRequest(creds, { dateType: "2", begin: "2026-10-12", end: "2026-10-12", format: "V1", paymentStatus: "1" })
    expect(r).toMatchObject({ MerchantID: "3002607", DateType: "2", BeginDate: "2026-10-12", EndDate: "2026-10-12", MediaFormated: "0", CharSet: "2", PaymentStatus: "1" })
    expect(verifyCheckMacValue(r, { hashKey: creds.hashKey, hashIV: creds.hashIV, algorithm: "sha256" })).toBe(true)
  })
})
