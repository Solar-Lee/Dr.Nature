// [P4-06] Staff: void the order's e-invoice with the buyer's recorded consent
// (電子發票實施作業要點 第九點). RBAC: order:update (middlewares.ts).
// Body: { reason: 1-20 chars, consent: { method: email|line|phone|web|in_person, note: 1-200 chars } }
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ecpayInvoiceConfigured } from "../../../../../../lib/ecpay/config"
import { voidEcpayInvoiceWorkflow } from "../../../../../../workflows/ecpay/void-ecpay-invoice"

const CONSENT_METHODS = ["email", "line", "phone", "web", "in_person"]

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  if (!ecpayInvoiceConfigured()) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "e-invoicing is not configured")
  }
  const body = (req.body ?? {}) as { reason?: unknown; consent?: { method?: unknown; note?: unknown } }
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  const method = typeof body.consent?.method === "string" ? body.consent.method : ""
  const note = typeof body.consent?.note === "string" ? body.consent.note.trim() : ""
  if (!reason || [...reason].length > 20) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "reason is required (20 characters max)")
  }
  if (!CONSENT_METHODS.includes(method) || !note || [...note].length > 200) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `the buyer's consent is required: consent.method (${CONSENT_METHODS.join("/")}) and consent.note (200 characters max)`
    )
  }
  const { result } = await voidEcpayInvoiceWorkflow(req.scope).run({
    input: { order_id: req.params.id, reason, consent: { method, note }, actor_id: req.auth_context.actor_id },
  })
  res.json({ invoice: result })
}
