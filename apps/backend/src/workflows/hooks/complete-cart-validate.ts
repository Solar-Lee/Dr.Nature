// The ONE completeCartWorkflow validate handler (Medusa 2.21.2 throws "Cannot define multiple
// hook handlers"). ECPay checks live in src/lib/ecpay/cart-checks.ts; the price floor and the
// one-offer rule in src/lib/pricing/.
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import {
  checkEcpayInvoiceCart,
  checkEcpayLogisticsCart,
  checkReservedCartMetadata,
  type CartView,
} from "../../lib/ecpay/cart-checks"
import { checkExclusiveOffers } from "../../lib/pricing/offer-rules"
import { checkPriceFloor, type FloorItem } from "../../lib/pricing/price-floor"

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  checkReservedCartMetadata(cart as CartView)
  checkPriceFloor(((cart as { items?: FloorItem[] }).items ?? []) as FloorItem[])
  await checkExclusiveOffers(((cart as { promotions?: { id: string }[] }).promotions ?? []).map((p) => p.id), container)
  await checkEcpayLogisticsCart(cart as CartView, container)
  await checkEcpayInvoiceCart(cart as CartView, container)
})
