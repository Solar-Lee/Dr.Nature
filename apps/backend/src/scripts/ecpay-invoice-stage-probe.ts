// Probes the REAL ECPay e-invoice stage environment with this codebase's AES envelope (P4-06).
// Stage only; ECPay's PUBLIC e-invoice sandbox merchant (developers.ecpay.com.tw/7849/).
// Stage invoices are never uploaded to the Ministry of Finance (INV-05). Steps:
//   1. Issue a member-carrier invoice, 2. Issue again with the same RelateNumber,
//   3. GetIssue by RelateNumber, 4. Invalid (void), 5. GetIssue again,
//   6. GetIssue / Invalid for an unknown invoice,
//   7. CheckBarcode / CheckLoveCode / GetCompanyNameByTaxID,
//   8. a discounted line whose amount is not divisible by its quantity (3 x 1116.67 = 3350.01
//      vs ItemAmount 3350), then void it.
// No real e-mail or phone. Usage (from apps/backend):
//   ../../infra/dev-env.sh pnpm exec medusa exec ./src/scripts/ecpay-invoice-stage-probe.ts
import crypto from "crypto"
import type { ExecArgs } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { INVOICE_HOSTS, buildInvoiceRequest, decryptInvoiceData } from "../lib/ecpay/invoice"

// ECPay PUBLIC e-invoice sandbox merchant (developers.ecpay.com.tw/7849/); not a secret.
const SANDBOX = { merchantId: "2000132", hashKey: "ejCk326UnaZWKisg", hashIV: "q9jcZX8Ib9LM8wYk" }

async function call(path: string, data: Record<string, unknown>) {
  const res = await fetch(`${INVOICE_HOSTS.stage}/B2CInvoice/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildInvoiceRequest(SANDBOX, data, new Date())),
  })
  const text = await res.text()
  let outer: Record<string, unknown> = {}
  let inner: unknown = null
  try {
    outer = JSON.parse(text)
    inner = typeof outer.Data === "string" && outer.Data ? decryptInvoiceData(outer.Data, SANDBOX) : null
  } catch (e) {
    inner = `unparsable: ${(e as Error).message}; body ${text.slice(0, 160)}`
  }
  console.log(JSON.stringify({ step: path, http: res.status, content_type: res.headers.get("content-type"), TransCode: outer.TransCode, TransMsg: outer.TransMsg, outer_keys: Object.keys(outer), data: inner }))
  return inner as Record<string, unknown> | null
}

export default async function ecpayInvoiceStageProbe(_: ExecArgs) {
  if (process.env.ECPAY_ENV !== "stage") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "invoice stage probe runs only with ECPAY_ENV=stage")
  }
  const relate = `DRNPROBE${crypto.randomBytes(6).toString("hex").toUpperCase()}`
  const issue = {
    RelateNumber: relate,
    CustomerEmail: "probe@drn.test",
    Print: "0",
    Donation: "0",
    CarrierType: "1",
    CarrierNum: "",
    TaxType: "1",
    SalesAmount: 2300,
    InvType: "07",
    vat: "1",
    Items: [
      { ItemSeq: 1, ItemName: "日日順益生菌 60顆", ItemCount: 2, ItemWord: "瓶", ItemPrice: 1150, ItemTaxType: "1", ItemAmount: 2300 },
    ],
  }
  const issued = await call("Issue", issue)
  await call("Issue", issue)
  await call("GetIssue", { RelateNumber: relate })
  if (issued?.InvoiceNo) {
    const date = String(issued.InvoiceDate ?? "").slice(0, 10).replace(/\//g, "-")
    await call("GetIssue", { InvoiceNo: issued.InvoiceNo, InvoiceDate: date })
    await call("Invalid", { InvoiceNo: issued.InvoiceNo, InvoiceDate: date, Reason: "probe void" })
    await call("Invalid", { InvoiceNo: issued.InvoiceNo, InvoiceDate: date, Reason: "probe void again" })
    await call("GetIssue", { RelateNumber: relate })
  }
  await call("GetIssue", { RelateNumber: "DRNPROBENEVERISSUED0" })
  await call("Invalid", { InvoiceNo: "ZZ00000000", InvoiceDate: "2026-10-13", Reason: "probe unknown" })
  await call("CheckBarcode", { BarCode: "/ABC+123" })
  await call("CheckLoveCode", { LoveCode: "168001" })
  await call("GetCompanyNameByTaxID", { UnifiedBusinessNo: "97025978" })
  await call("GetCompanyNameByTaxID", { UnifiedBusinessNo: "12345678" })
  const uneven = await call("Issue", {
    ...issue,
    RelateNumber: `${relate}U`,
    SalesAmount: 3350,
    Items: [{ ItemSeq: 1, ItemName: "日日順益生菌 60顆", ItemCount: 3, ItemWord: "件", ItemPrice: 1116.67, ItemTaxType: "1", ItemAmount: 3350 }],
  })
  if (uneven?.InvoiceNo) {
    const date = String(uneven.InvoiceDate ?? "").slice(0, 10).replace(/\//g, "-")
    await call("Invalid", { InvoiceNo: uneven.InvoiceNo, InvoiceDate: date, Reason: "probe void" })
  }
}
