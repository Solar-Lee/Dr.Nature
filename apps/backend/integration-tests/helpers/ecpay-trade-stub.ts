// Local stand-in for ECPay's QueryTradeInfo/V5 (on ECPAY_API_BASE_URL). Answers with the
// key=value body and SHA256 CheckMacValue real stage returned (docs/research/
// ecpay-stage-probe-2026-10-13.md). Modes: ok | 403 (rate limited) | down (connection dropped).
import http from "http"
import { computeCheckMacValue, verifyCheckMacValue } from "../../src/lib/ecpay/check-mac-value"

type Mac = { hashKey: string; hashIV: string; algorithm: "sha256" }
export type StubTrade = { status: string; amount: number; paymentType?: string }

export function makeTradeStub(merchantId: string, mac: Mac) {
  const trades = new Map<string, StubTrade>()
  const asked: string[] = []
  const state = { mode: "ok" as "ok" | "403" | "down" }
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const params = Object.fromEntries(new URLSearchParams(raw))
      if (req.url !== "/Cashier/QueryTradeInfo/V5" || !verifyCheckMacValue(params, mac)) {
        res.writeHead(400).end("bad request")
        return
      }
      asked.push(params.MerchantTradeNo)
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
    })
  })
  const reset = () => {
    trades.clear()
    asked.length = 0
    state.mode = "ok"
  }
  return { server, trades, asked, state, reset }
}
