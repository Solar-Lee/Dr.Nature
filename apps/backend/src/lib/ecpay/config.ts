// Builds ECPay provider options from the whitelisted environment variables (docs/ENV.md).
// Used by medusa-config.ts (provider registration) and the ReturnURL route (signature
// check), so both always use the same merchant credentials.
import { MedusaError } from "@medusajs/framework/utils"
import { AIO_ENDPOINTS, type EcpayEnvironment } from "./aio"

export type EcpayProviderOptions = {
  environment: EcpayEnvironment
  merchantId: string
  hashKey: string
  hashIV: string
  // Server-to-server notification URL (must be public HTTPS on 443 in stage/prod).
  returnUrl: string
  // Browser POST-back after payment (storefront page).
  orderResultUrl: string
  // "Back to store" button on the ECPay page.
  clientBackUrl: string
  // Server-to-server notice when an ATM / CVS / BARCODE payment code is issued.
  paymentInfoUrl: string
  // Stage only: treat vendor back-office simulated payments (SimulatePaid=1) as paid, so
  // ATM/CVS can be tested end to end. Refused in prod.
  acceptSimulatedPayments: boolean
  checkoutUrl: string
  queryTradeInfoUrl: string
}

export const ECPAY_PROVIDER_ID = "pp_ecpay_ecpay"
export const ECPAY_RETURN_PATH = "/hooks/ecpay/payment"
export const ECPAY_PAYMENT_INFO_PATH = "/hooks/ecpay/payment-info"

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]
  if (!value) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} is required for the ECPay provider`)
  }
  return value
}

export function ecpayOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): EcpayProviderOptions {
  const environment = required(env, "ECPAY_ENV")
  if (environment !== "stage" && environment !== "prod") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `ECPAY_ENV must be "stage" or "prod", got ${environment}`)
  }
  const backendUrl = required(env, "MEDUSA_BACKEND_URL").replace(/\/$/, "")
  const storefrontUrl = required(env, "STOREFRONT_URL").replace(/\/$/, "")

  // Test/dev override for the QueryTradeInfo host (a local stub). Never honoured in prod.
  const apiBase = env.ECPAY_API_BASE_URL?.replace(/\/$/, "")
  if (apiBase && environment === "prod") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPAY_API_BASE_URL must not be set when ECPAY_ENV=prod")
  }

  const acceptSimulatedPayments = env.ECPAY_ACCEPT_SIMULATED_PAYMENTS === "true"
  if (acceptSimulatedPayments && environment === "prod") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPAY_ACCEPT_SIMULATED_PAYMENTS must not be set when ECPAY_ENV=prod")
  }

  return {
    environment,
    merchantId: required(env, "ECPAY_MERCHANT_ID"),
    hashKey: required(env, "ECPAY_HASH_KEY"),
    hashIV: required(env, "ECPAY_HASH_IV"),
    returnUrl: `${backendUrl}${ECPAY_RETURN_PATH}`,
    orderResultUrl: `${storefrontUrl}/checkout/ecpay/result`,
    clientBackUrl: `${storefrontUrl}/account/orders`,
    paymentInfoUrl: `${backendUrl}${ECPAY_PAYMENT_INFO_PATH}`,
    acceptSimulatedPayments,
    checkoutUrl: AIO_ENDPOINTS[environment].checkout,
    queryTradeInfoUrl: apiBase
      ? `${apiBase}/Cashier/QueryTradeInfo/V5`
      : AIO_ENDPOINTS[environment].queryTradeInfo,
  }
}
