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

// ---- Logistics (P4-05) -------------------------------------------------------------------

export type EcpayLogisticsOptions = {
  environment: EcpayEnvironment
  merchantId: string
  hashKey: string
  hashIV: string
  // C2C 店到店 (Aki, 2026-10-13) or B2C 大宗寄倉. Switching is NOT just an env change: existing
  // shipping options store their subtype (drn-0006), so they must be recreated for the contract.
  contract: "C2C" | "B2C"
  sender: { name: string; cellphone: string; zipCode?: string; address?: string }
  // Signed status notices (server to server).
  statusReplyUrl: string
  // Storefront page that receives the (unsigned) e-map store choice in the browser.
  mapReplyUrl: string
  apiHost: string
}

export const ECPAY_LOGISTICS_PROVIDER_ID = "ecpay_logistics"
export const ECPAY_LOGISTICS_STATUS_PATH = "/hooks/ecpay/logistics"
// ECPay's PUBLIC logistics test merchants (developers.ecpay.com.tw/7398/): B2C/宅配, C2C.
const PUBLIC_LOGISTICS_SANDBOX_MERCHANTS = ["2000132", "2000933"]

export function ecpayLogisticsOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): EcpayLogisticsOptions {
  const environment = required(env, "ECPAY_ENV")
  if (environment !== "stage" && environment !== "prod") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `ECPAY_ENV must be "stage" or "prod", got ${environment}`)
  }
  const contract = env.ECPAY_LOGISTICS_CONTRACT ?? "C2C"
  if (contract !== "C2C" && contract !== "B2C") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `ECPAY_LOGISTICS_CONTRACT must be C2C or B2C, got ${contract}`)
  }
  const apiBase = env.ECPAY_LOGISTICS_API_BASE_URL?.replace(/\/$/, "")
  if (apiBase && environment === "prod") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPAY_LOGISTICS_API_BASE_URL must not be set when ECPAY_ENV=prod")
  }
  const merchantId = required(env, "ECPAY_LOGISTICS_MERCHANT_ID")
  if (environment === "prod" && PUBLIC_LOGISTICS_SANDBOX_MERCHANTS.includes(merchantId)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPAY_LOGISTICS_MERCHANT_ID is ECPay's public test merchant; not allowed when ECPAY_ENV=prod")
  }
  const backendUrl = required(env, "MEDUSA_BACKEND_URL").replace(/\/$/, "")
  const storefrontUrl = required(env, "STOREFRONT_URL").replace(/\/$/, "")
  return {
    environment,
    merchantId,
    hashKey: required(env, "ECPAY_LOGISTICS_HASH_KEY"),
    hashIV: required(env, "ECPAY_LOGISTICS_HASH_IV"),
    contract,
    sender: {
      name: required(env, "ECPAY_LOGISTICS_SENDER_NAME"),
      cellphone: required(env, "ECPAY_LOGISTICS_SENDER_CELLPHONE"),
      ...(env.ECPAY_LOGISTICS_SENDER_ZIPCODE ? { zipCode: env.ECPAY_LOGISTICS_SENDER_ZIPCODE } : {}),
      ...(env.ECPAY_LOGISTICS_SENDER_ADDRESS ? { address: env.ECPAY_LOGISTICS_SENDER_ADDRESS } : {}),
    },
    statusReplyUrl: `${backendUrl}${ECPAY_LOGISTICS_STATUS_PATH}`,
    mapReplyUrl: `${storefrontUrl}/checkout/ecpay/cvs-store`,
    apiHost: apiBase ?? (environment === "prod" ? "https://logistics.ecpay.com.tw" : "https://logistics-stage.ecpay.com.tw"),
  }
}

// ---- E-invoice (P4-06) ---------------------------------------------------------------------

export type EcpayInvoiceOptions = {
  environment: EcpayEnvironment
  merchantId: string
  hashKey: string
  hashIV: string
  apiHost: string
}

// ECPay's PUBLIC e-invoice test merchant (developers.ecpay.com.tw/7849/).
const PUBLIC_INVOICE_SANDBOX_MERCHANTS = ["2000132"]

export function ecpayInvoiceOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): EcpayInvoiceOptions {
  const environment = required(env, "ECPAY_ENV")
  if (environment !== "stage" && environment !== "prod") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `ECPAY_ENV must be "stage" or "prod", got ${environment}`)
  }
  const merchantId = required(env, "ECPAY_INVOICE_MERCHANT_ID")
  if (environment === "prod" && PUBLIC_INVOICE_SANDBOX_MERCHANTS.includes(merchantId)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPAY_INVOICE_MERCHANT_ID is ECPay's public test merchant; not allowed when ECPAY_ENV=prod")
  }
  const apiBase = env.ECPAY_INVOICE_API_BASE_URL?.replace(/\/$/, "")
  if (apiBase && environment === "prod") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPAY_INVOICE_API_BASE_URL must not be set when ECPAY_ENV=prod")
  }
  return {
    environment,
    merchantId,
    hashKey: required(env, "ECPAY_INVOICE_HASH_KEY"),
    hashIV: required(env, "ECPAY_INVOICE_HASH_IV"),
    apiHost: apiBase ?? (environment === "prod" ? "https://einvoice.ecpay.com.tw" : "https://einvoice-stage.ecpay.com.tw"),
  }
}

// Invoicing is on only when its merchant is configured; orders are never blocked by it.
export function ecpayInvoiceConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.ECPAY_ENV && !!env.ECPAY_INVOICE_MERCHANT_ID
}
