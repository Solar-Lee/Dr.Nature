// GET /store/ecpay/logistics/map-form?option=cvs-unimart&mobile=1  (P4-05)
// Returns the form the storefront POSTs (in the browser) to open ECPay's store map. ECPay
// posts the chosen store back to the storefront's ServerReplyURL page, which then adds the
// shipping method with { store: {...} }. The map request carries no CheckMacValue and no
// secrets (developers.ecpay.com.tw/8795/).
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ecpayLogisticsOptionsFromEnv } from "../../../../../lib/ecpay/config"
import { buildMapForm, type CvsSubtype } from "../../../../../lib/ecpay/logistics"
import { fulfillmentOptionsFor } from "../../../../../modules/ecpay-logistics/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const options = ecpayLogisticsOptionsFromEnv()
  const optionId = typeof req.query.option === "string" ? req.query.option : ""
  const option = fulfillmentOptionsFor(options.contract).find((o) => o.id === optionId && o.logistics_type === "CVS")
  if (!option) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "option must be a convenience-store option id")
  }
  const form = buildMapForm({
    credentials: { merchantId: options.merchantId, hashKey: options.hashKey, hashIV: options.hashIV },
    environment: options.environment,
    subtype: option.logistics_subtype as CvsSubtype,
    serverReplyUrl: options.mapReplyUrl,
    isMobile: req.query.mobile === "1",
    extraData: option.id,
  })
  res.json({ form })
}
