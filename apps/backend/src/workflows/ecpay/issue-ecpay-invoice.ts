// Issues the B2C e-invoice of a paid order through ECPay (P4-06), and reconciles canceled ones.
// When: a prepaid order is invoiced when payment is received (營業稅法 §32 時限表; see
// docs/research/ecpay-invoice-p4-06.md), i.e. once its ECPay payment is captured.
// Safe to run any number of times, from any trigger (subscribers, retry job, admin):
//  - a per-order lock serializes concurrent runs (and the cancel handling);
//  - one RelateNumber per invoice (relateNumberFor): if ECPay already has it (5070357) or
//    we got no answer, GetIssue finds the invoice and it is adopted, never issued twice;
//  - an issued/voided record is never re-issued here (re-issue = staff void with reissue);
//  - canceled orders are only reconciled (GetIssue), never issued; a valid invoice on a
//    canceled order raises [ECPAY-ALERT] (voiding needs the buyer's consent).
// The amount is the sale (items + shipping, tax-inclusive, after discounts). If the order
// total no longer equals it (a refund credit line, a later order edit), nothing is issued
// automatically: staff decide (allowance / extra invoice). Never blocks an order: failures
// are recorded (status "failed") and retried by jobs/ecpay-invoice-retry.ts.
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { ecpayInvoiceConfigured, ecpayInvoiceOptionsFromEnv, type EcpayInvoiceOptions } from "../../lib/ecpay/config"
import {
  DEFAULT_INVOICE_CHOICE,
  buildIssueData,
  issuedFromGetIssue,
  issuedFromIssue,
  parseInvoiceChoice,
  relateNumberFor,
  type InvoiceChoice,
  type InvoiceRecord,
} from "../../lib/ecpay/invoice"
import { invoiceCall } from "../../lib/ecpay/invoice-client"
import { ECPAY_INVOICE_KEY, saveEcpayInvoiceRecordStep } from "./ecpay-invoice-steps"

type Input = { order_id: string }
export type IssueEcpayInvoiceResult = {
  outcome: "issued" | "adopted" | "already" | "skipped" | "failed"
  reason?: string
  invoice_no?: string
}

// A transport failure alerts on this attempt and then every ALERT_EVERY attempts (the job
// runs every 15 minutes, so about every 4 hours); a business refusal alerts every time.
const ALERT_FROM_ATTEMPT = 3
const ALERT_EVERY = 16

export const shouldAlertTransportFailure = (attempts: number) =>
  attempts === ALERT_FROM_ATTEMPT || (attempts > ALERT_FROM_ATTEMPT && (attempts - ALERT_FROM_ATTEMPT) % ALERT_EVERY === 0)

type OrderView = {
  id: string
  email?: string | null
  status: string
  total: unknown
  shipping_total: unknown
  metadata?: Record<string, unknown> | null
  customer?: { email?: string | null } | null
  items?: { title?: string | null; product_title?: string | null; quantity?: unknown; detail?: { quantity?: unknown }; total?: unknown }[]
  payment_collections?: { payments?: { captured_at?: unknown }[] | null }[] | null
}

type Decision = { result: IssueEcpayInvoiceResult; record: InvoiceRecord | null }

// The sale the invoice states: line totals + shipping, whole TWD.
export function saleAmount(order: Pick<OrderView, "items" | "shipping_total">): number {
  const items = (order.items ?? []).reduce((sum, i) => sum + Number(i.total ?? 0), 0)
  return Math.round(items + Number(order.shipping_total ?? 0))
}

async function registeredCompanyName(options: EcpayInvoiceOptions, choice: InvoiceChoice): Promise<InvoiceChoice> {
  if (choice.type !== "company") return choice
  // ECPay's registry name for the tax id (GetCompanyNameByTaxID); the typed title is only a
  // fallback when the lookup is unavailable.
  const r = await invoiceCall(options, "GetCompanyNameByTaxID", { UnifiedBusinessNo: choice.tax_id })
  const name = r.ok && typeof r.data.CompanyName === "string" ? r.data.CompanyName.trim() : ""
  return name ? { ...choice, title: [...name].slice(0, 60).join("") } : choice
}

async function issueInvoice(input: Input, container: MedusaContainer): Promise<Decision> {
  const done = (result: IssueEcpayInvoiceResult, record: InvoiceRecord | null = null): Decision => ({ result, record })
  if (!ecpayInvoiceConfigured()) {
    return done({ outcome: "skipped", reason: "e-invoicing is not configured" })
  }
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const alert = (msg: string) => logger.error(`[ECPAY-ALERT] e-invoice: ${msg}`)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id", "email", "status", "total", "shipping_total", "metadata", "customer.email",
      "items.title", "items.product_title", "items.quantity", "items.detail.quantity", "items.total",
      "payment_collections.payments.captured_at",
    ],
    filters: { id: input.order_id },
  })
  const order = data[0] as unknown as OrderView | undefined
  if (!order) {
    return done({ outcome: "skipped", reason: "order not found" })
  }
  const existing = order.metadata?.[ECPAY_INVOICE_KEY] as InvoiceRecord | undefined
  const canceled = order.status === "canceled"
  const sale = saleAmount(order)

  if (existing?.status === "issued") {
    if (canceled) {
      alert(`order ${order.id} is canceled but invoice ${existing.invoice_no} is valid: get the buyer's consent, then void it (POST /admin/orders/${order.id}/ecpay-invoice/void) or issue an allowance`)
    } else if (existing.sales_amount !== undefined && existing.sales_amount !== sale) {
      alert(`order ${order.id} now totals NT$${sale} but invoice ${existing.invoice_no} states NT$${existing.sales_amount}: issue an allowance or a supplementary invoice`)
    }
    return done({ outcome: "already", invoice_no: existing.invoice_no })
  }
  if (existing?.status === "voided") {
    if (!canceled) {
      alert(`order ${order.id} is active but its invoice ${existing.invoice_no} is voided: re-issue it (void route with reissue) or issue manually`)
    }
    return done({ outcome: "already", invoice_no: existing.invoice_no })
  }
  const paid = (order.payment_collections ?? []).some((pc) => (pc.payments ?? []).some((p) => !!p.captured_at))
  if (!paid) {
    return done({ outcome: "skipped", reason: "payment not captured" })
  }

  const sequence = existing?.sequence ?? 0
  const relate = existing?.relate_number ?? relateNumberFor(order.id, sequence)
  const now = new Date().toISOString()
  const attempts = (existing?.attempts ?? 0) + 1
  const keep = {
    relate_number: relate,
    ...(sequence ? { sequence } : {}),
    ...(existing?.previous ? { previous: existing.previous } : {}),
  }
  const fail = (error: string, alertNow: boolean, choice?: InvoiceChoice) => {
    if (alertNow) {
      alert(`order ${order.id} (RelateNumber ${relate}) failed: ${error}`)
    } else {
      logger.warn(`e-invoice for order ${order.id} failed (attempt ${attempts}), will retry: ${error}`)
    }
    return done(
      { outcome: "failed", reason: error },
      { status: "failed", ...keep, error, attempts, updated_at: now, ...(choice ? { choice } : {}) }
    )
  }

  let options: EcpayInvoiceOptions
  try {
    options = ecpayInvoiceOptionsFromEnv()
  } catch (e) {
    return fail(`configuration: ${(e as Error).message}`, true)
  }

  // Whatever ECPay already holds for this RelateNumber wins (lost answers, duplicates).
  const adopt = async (why: string): Promise<Decision | null> => {
    const found = await invoiceCall(options, "GetIssue", { RelateNumber: relate })
    if (!found.ok) return null
    const f = issuedFromGetIssue(found.data)
    if (f.relate_number.toUpperCase() !== relate.toUpperCase() || !f.invoice_no) return null
    logger.warn(`e-invoice for order ${order.id}: ${why}; ECPay already has ${f.invoice_no}`)
    if (!f.voided && canceled) {
      alert(`order ${order.id} is canceled but ECPay holds valid invoice ${f.invoice_no}: get the buyer's consent, then void it (POST /admin/orders/${order.id}/ecpay-invoice/void) or issue an allowance`)
    }
    if (f.voided && !canceled) {
      alert(`order ${order.id} is active but ECPay shows its invoice ${f.invoice_no} voided: re-issue it (void route with reissue) or issue manually`)
    }
    return done(
      { outcome: "adopted", invoice_no: f.invoice_no },
      {
        status: f.voided ? "voided" : "issued",
        ...keep,
        invoice_no: f.invoice_no,
        invoice_date: f.invoice_date,
        random_number: f.random_number,
        sales_amount: Number.isFinite(f.sales_amount) ? f.sales_amount : sale,
        ...(existing?.choice ? { choice: existing.choice } : {}),
        attempts,
        updated_at: now,
      }
    )
  }

  if (canceled) {
    // Reconcile only: never issue for a canceled order.
    const adopted = existing ? await adopt("order canceled") : await adopt("order canceled, no local record")
    return adopted ?? done({ outcome: "skipped", reason: "order canceled" })
  }

  if (Math.round(Number(order.total)) !== sale) {
    return fail(`order total NT$${Math.round(Number(order.total))} differs from the sale NT$${sale} (refund or credit line): issue manually`, true)
  }
  const parsed = parseInvoiceChoice(existing?.choice ?? order.metadata?.ecpay_invoice_choice ?? DEFAULT_INVOICE_CHOICE)
  if (!parsed.ok) {
    return fail(`invoice choice on the order is invalid: ${parsed.message}`, true)
  }
  const choice = await registeredCompanyName(options, parsed.choice)
  const email = (order.email || order.customer?.email || "").trim()
  let issueData: Record<string, unknown>
  try {
    issueData = buildIssueData({
      relateNumber: relate,
      email,
      choice,
      salesAmount: sale,
      lines: (order.items ?? []).map((i) => ({
        title: i.product_title || i.title || "",
        quantity: Number(i.quantity ?? i.detail?.quantity),
        total: Number(i.total),
      })),
      shippingTotal: Number(order.shipping_total ?? 0),
    })
  } catch (e) {
    return fail((e as Error).message, true, choice)
  }

  const issued = await invoiceCall(options, "Issue", issueData)
  if (issued.ok) {
    const f = issuedFromIssue(issued.data)
    logger.info(`e-invoice ${f.invoice_no} issued for order ${order.id}`)
    return done(
      { outcome: "issued", invoice_no: f.invoice_no },
      { status: "issued", ...keep, ...f, sales_amount: sale, choice, attempts, updated_at: now }
    )
  }
  const adopted = await adopt(`Issue answered "${issued.message}"`)
  if (adopted) {
    adopted.record = { ...adopted.record!, choice }
    return adopted
  }
  return fail(issued.message, !issued.transport || shouldAlertTransportFailure(attempts), choice)
}

// No compensation: an issued invoice cannot be un-issued here; a re-run adopts it.
export const issueEcpayInvoiceStep = createStep("issue-ecpay-invoice", async (input: Input, { container }) => {
  return new StepResponse(await issueInvoice(input, container))
})

export const issueEcpayInvoiceWorkflow = createWorkflow("issue-ecpay-invoice", (input: Input) => {
  const lockKey = transform({ input }, ({ input }) => `drn-einvoice:${input.order_id}`)
  acquireLockStep({ key: lockKey, timeout: 30, ttl: 120 })
  const issued = issueEcpayInvoiceStep(input)
  saveEcpayInvoiceRecordStep(
    transform({ input, issued }, ({ input, issued }) => ({ order_id: input.order_id, values: issued.record ? { [ECPAY_INVOICE_KEY]: issued.record } : null }))
  )
  releaseLockStep({ key: lockKey })
  return new WorkflowResponse(transform({ issued }, ({ issued }) => issued.result))
})
