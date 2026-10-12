// The ONE completeCartWorkflow validate handler (Medusa 2.21.2 throws "Cannot define multiple
// hook handlers"). ECPay checks live in src/lib/ecpay/cart-checks.ts; the price floor in
// src/lib/pricing/price-floor.ts.
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import {
  checkEcpayInvoiceCart,
  checkEcpayLogisticsCart,
  checkReservedCartMetadata,
  type CartView,
} from "../../lib/ecpay/cart-checks"
import { checkPriceFloor, type FloorItem } from "../../lib/pricing/price-floor"

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  checkReservedCartMetadata(cart as CartView)
  checkPriceFloor(((cart as { items?: FloorItem[] }).items ?? []) as FloorItem[])
  await checkEcpayLogisticsCart(cart as CartView, container)
  await checkEcpayInvoiceCart(cart as CartView, container)
})
