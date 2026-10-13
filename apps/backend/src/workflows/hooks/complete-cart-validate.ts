// The ONE completeCartWorkflow validate handler (Medusa 2.21.2 throws "Cannot define multiple
// hook handlers"). ECPay checks live in src/lib/ecpay/cart-checks.ts; the price rules and the
// promotion checks in src/lib/pricing/.
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import {
  checkEcpayInvoiceCart,
  checkEcpayLogisticsCart,
  checkReservedCartMetadata,
  type CartView,
} from "../../lib/ecpay/cart-checks"
import { checkCartPromotions, type PromotionCart } from "../../lib/pricing/cart-promotions"
import { checkPriceFloor, type FloorItem } from "../../lib/pricing/price-floor"

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  checkReservedCartMetadata(cart as CartView)
  checkPriceFloor(((cart as { items?: FloorItem[] }).items ?? []) as FloorItem[])
  // Promotions still live, R2, member-price conditions (src/lib/pricing/cart-promotions.ts).
  await checkCartPromotions(cart as PromotionCart, container)
  await checkEcpayLogisticsCart(cart as CartView, container)
  await checkEcpayInvoiceCart(cart as CartView, container)
})
