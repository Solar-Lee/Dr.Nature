// Voids (作廢) an order's ECPay e-invoice (P4-06). Staff action only: voiding a B2C
// e-invoice needs the buyer's consent, kept as evidence for 5 years (電子發票實施作業要點
// 第九點; docs/research/ecpay-invoice-p4-06.md), so the consent is a required input and is
// stored on the order with the void. Deadline: ECPay refuses voids of the previous two-month
// period after the 13th of each odd month (INV-09); then an allowance (折讓) is needed.
// Retry-safe: if Invalid fails, GetIssue decides whether it is in fact already voided.
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { ecpayInvoiceOptionsFromEnv } from "../../lib/ecpay/config"
import { invoiceDay, issuedFromGetIssue, type InvoiceRecord } from "../../lib/ecpay/invoice"
import { invoiceCall } from "../../lib/ecpay/invoice-client"
import { ECPAY_INVOICE_KEY, saveEcpayInvoiceRecordStep } from "./ecpay-invoice-steps"

export type VoidEcpayInvoiceInput = {
  order_id: string
  reason: string
  consent: { method: string; note: string }
  actor_id: string
}

export const voidEcpayInvoiceStep = createStep("void-ecpay-invoice", async (input: VoidEcpayInvoiceInput, { container }) => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const order = await container.resolve(Modules.ORDER).retrieveOrder(input.order_id, { select: ["id", "metadata"] })
  const record = order.metadata?.[ECPAY_INVOICE_KEY] as InvoiceRecord | undefined
  if (!record || record.status !== "issued" || !record.invoice_no || !record.invoice_date) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `order ${order.id} has no issued e-invoice to void`)
  }
  const now = new Date().toISOString()
  const voided: InvoiceRecord = {
    ...record,
    status: "voided",
    updated_at: now,
    void: { at: now, reason: input.reason, consent: input.consent, by: input.actor_id },
  }
  const options = ecpayInvoiceOptionsFromEnv()
  const res = await invoiceCall(options, "Invalid", {
    InvoiceNo: record.invoice_no,
    InvoiceDate: invoiceDay(record.invoice_date),
    Reason: [...input.reason].slice(0, 20).join(""),
  })
  if (res.ok) {
    logger.info(`e-invoice ${record.invoice_no} of order ${order.id} voided`)
    return new StepResponse(voided)
  }
  // Already voided (5070453) or the answer was lost: ECPay's own record decides.
  const found = await invoiceCall(options, "GetIssue", { RelateNumber: record.relate_number })
  if (found.ok && issuedFromGetIssue(found.data).voided) {
    logger.warn(`e-invoice ${record.invoice_no}: Invalid answered "${res.message}"; ECPay shows it voided`)
    return new StepResponse(voided)
  }
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    `ECPay did not void ${record.invoice_no}: ${res.message}. Past the void deadline an allowance (折讓) is needed.`
  )
})

export const voidEcpayInvoiceWorkflow = createWorkflow("void-ecpay-invoice", (input: VoidEcpayInvoiceInput) => {
  const lockKey = transform({ input }, ({ input }) => `drn-einvoice:${input.order_id}`)
  acquireLockStep({ key: lockKey, timeout: 30, ttl: 120 })
  const record = voidEcpayInvoiceStep(input)
  saveEcpayInvoiceRecordStep(transform({ input, record }, ({ input, record }) => ({ order_id: input.order_id, record })))
  releaseLockStep({ key: lockKey })
  return new WorkflowResponse(record)
})
