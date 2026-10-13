// Local stand-in for ECPay's QueryTradeInfo/V5 (on ECPAY_API_BASE_URL). Answers with the
// key=value body and SHA256 CheckMacValue real stage returned (docs/research/
// ecpay-stage-probe-2026-10-13.md). Modes: ok | 403 (rate limited) | down (connection dropped).
// state.delayMs holds each QueryTradeInfo answer back (widens race windows in the P4-09 lock
// tests); the trade is listed in `asked` as soon as the request arrives.
// Also serves the daily TradeNoAio CSV (P4-07) in the V1 layout real stage returned.
import http from "http"
import { computeCheckMacValue, verifyCheckMacValue } from "../../src/lib/ecpay/check-mac-value"

type Mac = { hashKey: string; hashIV: string; algorithm: "sha256" }
export type StubTrade = { status: string; amount: number; paymentType?: string }
export type FileRow = { merchantTradeNo: string; tradeNo?: string; amount: number; method?: string; result?: string }

const HEADER = "交易日期,綠界交易序號,特店訂單編號,ATM條碼,交易金額,付款方式,付款結果,付款日期,款項來源(銀行/超商),通路費,交易服務費率(%數 / $筆),交易服務費金額,應收款項(淨額),撥款狀態,撥款日期,備註,交易處理費"

export function makeTradeStub(merchantId: string, mac: Mac) {
  const trades = new Map<string, StubTrade>()
  const asked: string[] = []
  const state = { mode: "ok" as "ok" | "403" | "down", fileRows: [] as FileRow[], fileError: "", delayMs: 0 }
  const fileRequests: Record<string, string>[] = []
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const params = Object.fromEntries(new URLSearchParams(raw))
      if (req.url === "/PaymentMedia/TradeNoAio" && verifyCheckMacValue(params, mac)) {
        fileRequests.push(params)
        const body = state.fileError
          ? [HEADER, `${",".repeat(15)}${state.fileError},`]
          : [
              HEADER,
              ...state.fileRows.map((r) =>
                [`${params.BeginDate} 01:00:00`, r.tradeNo ?? `T${r.merchantTradeNo.slice(-10)}`, r.merchantTradeNo, '=""', r.amount, r.method ?? "信用卡", r.result ?? "已付款", `${params.BeginDate} 01:05:00`, "信用卡", 0, "2.4500%", 1, r.amount - 1, "未撥款", "", "-", "1.00", ""].join(",")
              ),
            ]
        res.writeHead(200, { "content-type": "text/html" })
        res.end("\uFEFF" + body.join("\r\n"))
        return
      }
      if (req.url !== "/Cashier/QueryTradeInfo/V5" || !verifyCheckMacValue(params, mac)) {
        res.writeHead(400).end("bad request")
        return
      }
      asked.push(params.MerchantTradeNo)
      const answer = () => {
        if (state.mode === "403") {
          res.writeHead(403).end("Forbidden")
          return
        }
        if (state.mode === "down") {
          req.socket.destroy()
          return
        }
        const t = trades.get(params.MerchantTradeNo) ?? { status: "0", amount: 0 }
        const fields = {
          MerchantID: merchantId,
          MerchantTradeNo: params.MerchantTradeNo,
          TradeNo: `T${params.MerchantTradeNo.slice(-10)}`,
          TradeAmt: String(t.amount),
          TradeStatus: t.status,
          PaymentType: t.paymentType ?? "Credit_CreditCard",
          PaymentDate: t.status === "1" ? "2026/10/13 05:00:00" : "",
        }
        res.writeHead(200, { "content-type": "text/html" })
        res.end(new URLSearchParams({ ...fields, CheckMacValue: computeCheckMacValue(fields, mac) }).toString())
      }
      if (state.delayMs > 0) setTimeout(answer, state.delayMs)
      else answer()
    })
  })
  const reset = () => {
    trades.clear()
    asked.length = 0
    fileRequests.length = 0
    state.mode = "ok"
    state.fileRows = []
    state.fileError = ""
    state.delayMs = 0
  }
  return { server, trades, asked, state, fileRequests, reset }
}
