// Local stand-in for ECPay's B2C e-invoice API (P4-06), used on ECPAY_INVOICE_API_BASE_URL.
// Speaks the real envelope (JSON + AES-128-CBC, src/lib/ecpay/invoice.ts) and mirrors what
// real stage answered on 2026-10-13 (docs/research/ecpay-invoice-p4-06.md):
//  Issue -> InvoiceNo/InvoiceDate/RandomNumber; reused RelateNumber -> 5070357;
//  GetIssue by RelateNumber -> IIS_* fields, unknown -> 2; Invalid -> 1, again -> 5070453,
//  unknown -> 1600003.
import http from "http"
import { decryptInvoiceData, encryptInvoiceData } from "../../src/lib/ecpay/invoice"

type Creds = { merchantId: string; hashKey: string; hashIV: string }
export type StubInvoice = {
  data: Record<string, any>
  invoiceNo: string
  invoiceDate: string
  random: string
  voided: boolean
}

export function makeInvoiceStub(creds: Creds) {
  const requests: { path: string; data: Record<string, any> }[] = []
  const invoices = new Map<string, StubInvoice>() // by RelateNumber
  // ok | refuse (business error) | drop (issued, connection dropped) | down (nothing, dropped)
  const state = { mode: "ok" as "ok" | "refuse" | "drop" | "down", seq: 22068041 }

  const answer = (res: http.ServerResponse, data: Record<string, unknown>) => {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
    res.end(
      JSON.stringify({
        PlatformID: "",
        MerchantID: creds.merchantId,
        RpHeader: { Timestamp: Math.floor(Date.now() / 1000) },
        TransCode: 1,
        TransMsg: "Success",
        Data: encryptInvoiceData(data, creds),
      })
    )
  }

  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      let data: Record<string, any>
      try {
        const outer = JSON.parse(raw)
        if (outer.MerchantID !== creds.merchantId) {
          throw new Error("merchant")
        }
        data = decryptInvoiceData(outer.Data, creds) as Record<string, any>
      } catch {
        res.writeHead(500).end("decrypt error")
        return
      }
      const path = String(req.url).replace("/B2CInvoice/", "")
      requests.push({ path, data })
      if (path === "Issue") {
        if (state.mode === "down") {
          req.socket.destroy()
          return
        }
        if (state.mode === "refuse") {
          answer(res, { RtnCode: 1500019, RtnMsg: "stub refusal", InvoiceNo: "", InvoiceDate: "", RandomNumber: "" })
          return
        }
        if (invoices.has(data.RelateNumber)) {
          answer(res, { RtnCode: 5070357, RtnMsg: "B2C開立發票 自訂編號重覆，請重新設定", InvoiceNo: "", InvoiceDate: "", RandomNumber: "" })
          return
        }
        const inv: StubInvoice = {
          data,
          invoiceNo: `LO${state.seq++}`,
          invoiceDate: "2026-10-13 03:50:42",
          random: String(1000 + (state.seq % 9000)),
          voided: false,
        }
        invoices.set(data.RelateNumber, inv)
        if (state.mode === "drop") {
          req.socket.destroy()
          return
        }
        answer(res, { RtnCode: 1, RtnMsg: "開立發票成功", InvoiceNo: inv.invoiceNo, InvoiceDate: inv.invoiceDate, RandomNumber: inv.random })
        return
      }
      if (path === "GetIssue") {
        const inv = [...invoices.values()].find(
          (i) => i.data.RelateNumber === data.RelateNumber || (data.InvoiceNo && i.invoiceNo === data.InvoiceNo)
        )
        if (!inv) {
          answer(res, { RtnCode: 2, RtnMsg: "查無發票資料，請重新確認" })
          return
        }
        answer(res, {
          RtnCode: 1,
          RtnMsg: "",
          IIS_Number: inv.invoiceNo,
          IIS_Relate_Number: inv.data.RelateNumber,
          IIS_Create_Date: inv.invoiceDate,
          IIS_Random_Number: inv.random,
          IIS_Sales_Amount: inv.data.SalesAmount,
          IIS_Carrier_Type: inv.data.CarrierType,
          IIS_Issue_Status: "1",
          IIS_Invalid_Status: inv.voided ? "1" : "0",
        })
        return
      }
      if (path === "Invalid") {
        const inv = [...invoices.values()].find((i) => i.invoiceNo === data.InvoiceNo)
        if (!inv) {
          answer(res, { RtnCode: 1600003, RtnMsg: "無發票號碼資料", InvoiceNo: null })
          return
        }
        if (inv.voided) {
          answer(res, { RtnCode: 5070453, RtnMsg: "B2C作廢發票 該發票已被作廢過", InvoiceNo: inv.invoiceNo })
          return
        }
        inv.voided = true
        answer(res, { RtnCode: 1, RtnMsg: "作廢發票成功", InvoiceNo: inv.invoiceNo })
        return
      }
      if (path === "CheckBarcode") {
        answer(res, { RtnCode: 1, RtnMsg: "", IsExist: data.BarCode === "/NOTREAL" ? "N" : "Y" })
        return
      }
      if (path === "CheckLoveCode") {
        answer(res, { RtnCode: 1, RtnMsg: "", IsExist: data.LoveCode === "999" ? "N" : "Y", OrganName: "stub" })
        return
      }
      if (path === "GetCompanyNameByTaxID") {
        answer(
          res,
          data.UnifiedBusinessNo === "12345678"
            ? { RtnCode: 1200125, RtnMsg: "統一編號檢查碼驗證失敗，請再確認", CompanyName: null }
            : { RtnCode: 1, RtnMsg: "查詢名稱成功", CompanyName: "stub company" }
        )
        return
      }
      res.writeHead(404).end()
    })
  })
  return { server, requests, invoices, state }
}
