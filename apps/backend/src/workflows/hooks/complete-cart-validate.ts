// The ONE completeCartWorkflow validate handler (Medusa 2.21.2 throws "Cannot define multiple
// hook handlers"). Each check lives in src/lib/ecpay/cart-checks.ts.
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import {
  checkEcpayInvoiceCart,
  checkEcpayLogisticsCart,
  checkReservedCartMetadata,
  type CartView,
} from "../../lib/ecpay/cart-checks"

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  checkReservedCartMetadata(cart as CartView)
  await checkEcpayLogisticsCart(cart as CartView, container)
  await checkEcpayInvoiceCart(cart as CartView, container)
})
