// Issues the B2C e-invoice of a paid order through ECPay (P4-06).
// When: a prepaid order is invoiced when payment is received (營業稅法 §32 時限表; see
// docs/research/ecpay-invoice-p4-06.md), i.e. once its ECPay payment is captured.
// Safe to run any number of times, from any trigger (subscriber, retry job, admin):
//  - a per-order lock serializes concurrent runs;
//  - one RelateNumber per order: if ECPay already has it (5070357) or we got no answer,
//    GetIssue finds the invoice and it is adopted instead of issuing a second one;
//  - an existing issued/voided record is never touched.
// Never blocks an order: failures are recorded (status "failed") and retried by the job.
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { ecpayInvoiceConfigured, ecpayInvoiceOptionsFromEnv } from "../../lib/ecpay/config"
import {
  DEFAULT_INVOICE_CHOICE,
  buildIssueData,
  issuedFromGetIssue,
  issuedFromIssue,
  parseInvoiceChoice,
  relateNumberFor,
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

// Alert on a transport failure only from this attempt on; the retry job keeps trying.
const ALERT_AFTER_TRANSPORT_FAILURES = 3

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

async function issueInvoice(input: Input, container: MedusaContainer): Promise<Decision> {
  const done = (result: IssueEcpayInvoiceResult, record: InvoiceRecord | null = null): Decision => ({ result, record })
  if (!ecpayInvoiceConfigured()) {
    return done({ outcome: "skipped", reason: "e-invoicing is not configured" })
  }
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
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
  if (existing?.status === "issued" || existing?.status === "voided") {
    return done({ outcome: "already", invoice_no: existing.invoice_no })
  }
  const paid = (order.payment_collections ?? []).some((pc) => (pc.payments ?? []).some((p) => !!p.captured_at))
  if (!paid) {
    return done({ outcome: "skipped", reason: "payment not captured" })
  }
  const relate = relateNumberFor(order.id)
  const now = new Date().toISOString()
  if (order.status === "canceled") {
    // Paid but canceled (e.g. paid after cancel): staff decide; see ecpay-manual-refund.md.
    logger.error(`[ECPAY-ALERT] e-invoice: order ${order.id} is paid but canceled; issue or skip the invoice manually`)
    return done({ outcome: "skipped", reason: "order canceled" })
  }

  const choiceInput = order.metadata?.ecpay_invoice_choice ?? DEFAULT_INVOICE_CHOICE
  const parsed = parseInvoiceChoice(choiceInput)
  const attempts = (existing?.attempts ?? 0) + 1
  const fail = (error: string, alert: boolean) => {
    if (alert) {
      logger.error(`[ECPAY-ALERT] e-invoice for order ${order.id} (RelateNumber ${relate}) failed: ${error}`)
    } else {
      logger.warn(`e-invoice for order ${order.id} failed (attempt ${attempts}), will retry: ${error}`)
    }
    return done(
      { outcome: "failed", reason: error },
      { status: "failed", relate_number: relate, error, attempts, updated_at: now, ...(parsed.ok ? { choice: parsed.choice } : {}) }
    )
  }
  if (!parsed.ok) {
    return fail(`invoice choice on the order is invalid: ${parsed.message}`, true)
  }
  const email = (order.email || order.customer?.email || "").trim()
  const salesAmount = Math.round(Number(order.total))
  let issueData: Record<string, unknown>
  try {
    issueData = buildIssueData({
      relateNumber: relate,
      email,
      choice: parsed.choice,
      salesAmount,
      lines: (order.items ?? []).map((i) => ({
        title: i.product_title || i.title || "",
        quantity: Number(i.quantity ?? i.detail?.quantity),
        total: Number(i.total),
      })),
      shippingTotal: Number(order.shipping_total ?? 0),
    })
  } catch (e) {
    return fail((e as Error).message, true)
  }

  const options = ecpayInvoiceOptionsFromEnv()
  const issued = await invoiceCall(options, "Issue", issueData)
  const base = { relate_number: relate, sales_amount: salesAmount, choice: parsed.choice, attempts, updated_at: now }
  if (issued.ok) {
    const f = issuedFromIssue(issued.data)
    logger.info(`e-invoice ${f.invoice_no} issued for order ${order.id}`)
    return done({ outcome: "issued", invoice_no: f.invoice_no }, { status: "issued", ...base, ...f })
  }
  // Duplicate RelateNumber, a lost answer, or any refusal: ask ECPay what it has.
  const found = await invoiceCall(options, "GetIssue", { RelateNumber: relate })
  if (found.ok) {
    const f = issuedFromGetIssue(found.data)
    if (f.relate_number.toUpperCase() === relate.toUpperCase() && f.invoice_no) {
      logger.warn(`e-invoice for order ${order.id}: Issue answered "${issued.message}"; ECPay already has ${f.invoice_no}`)
      return done(
        { outcome: "adopted", invoice_no: f.invoice_no },
        {
          status: f.voided ? "voided" : "issued",
          ...base,
          invoice_no: f.invoice_no,
          invoice_date: f.invoice_date,
          random_number: f.random_number,
          ...(Number.isFinite(f.sales_amount) ? { sales_amount: f.sales_amount } : {}),
        }
      )
    }
  }
  return fail(issued.message, !issued.transport || attempts >= ALERT_AFTER_TRANSPORT_FAILURES)
}

// No compensation: an issued invoice cannot be un-issued here; a re-run adopts it.
export const issueEcpayInvoiceStep = createStep("issue-ecpay-invoice", async (input: Input, { container }) => {
  return new StepResponse(await issueInvoice(input, container))
})

export const issueEcpayInvoiceWorkflow = createWorkflow("issue-ecpay-invoice", (input: Input) => {
  const lockKey = transform({ input }, ({ input }) => `drn-einvoice:${input.order_id}`)
  acquireLockStep({ key: lockKey, timeout: 30, ttl: 120 })
  const issued = issueEcpayInvoiceStep(input)
  saveEcpayInvoiceRecordStep(transform({ input, issued }, ({ input, issued }) => ({ order_id: input.order_id, record: issued.record })))
  releaseLockStep({ key: lockKey })
  return new WorkflowResponse(transform({ issued }, ({ issued }) => issued.result))
})
