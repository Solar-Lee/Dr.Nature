// [P4-06] Staff: issue (or retry) the order's e-invoice now. Same idempotent workflow as the
// subscriber and the retry job. RBAC: order:update (middlewares.ts).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ecpayInvoiceConfigured } from "../../../../../../lib/ecpay/config"
import { issueEcpayInvoiceWorkflow } from "../../../../../../workflows/ecpay/issue-ecpay-invoice"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  if (!ecpayInvoiceConfigured()) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "e-invoicing is not configured")
  }
  const { result } = await issueEcpayInvoiceWorkflow(req.scope).run({ input: { order_id: req.params.id } })
  res.json({ result })
}
