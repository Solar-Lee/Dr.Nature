// [P4-03] ECPay becomes the Taiwan region's only payment provider. pp_system_default is
// always registered by Medusa and cannot be disabled by config, so it is removed from the
// region (session creation and cart completion reject providers not on the region).
// Fails, and stays pending, if pp_ecpay_ecpay is not registered (ECPAY_* env missing).
import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { updateRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { ECPAY_PROVIDER_ID } from "../lib/ecpay/config"
import { REGION_NAME } from "../lib/drn-setup"

export default async function drnEcpayPaymentProvider({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const [region] = await container.resolve(Modules.REGION).listRegions({ name: REGION_NAME })
  if (!region) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "[drn-0005] Taiwan region missing; drn-0001 must run first")
  }
  const providers = await container
    .resolve(Modules.PAYMENT)
    .listPaymentProviders({ id: [ECPAY_PROVIDER_ID], is_enabled: true })
  if (!providers.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `[drn-0005] payment provider ${ECPAY_PROVIDER_ID} is not registered; set ECPAY_* (docs/ENV.md)`
    )
  }
  // updateRegionsWorkflow replaces the region's provider list.
  await updateRegionsWorkflow(container).run({
    input: { selector: { id: region.id }, update: { payment_providers: [ECPAY_PROVIDER_ID] } },
  })
  logger.info(`[drn-0005] ${REGION_NAME} payment providers = [${ECPAY_PROVIDER_ID}]`)
}
