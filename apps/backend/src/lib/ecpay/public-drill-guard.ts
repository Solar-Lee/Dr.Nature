// Gate for the public-URL sandbox drill (P12-10a, deployment review C9). The drill script
// places real orders and posts self-signed notices, so it may only run against ECPay's PUBLIC
// stage merchants (developers.ecpay.com.tw/2856/ payment 3002607, /7398/ C2C logistics 2000933)
// and only when the backend has a public HTTPS URL to receive ECPay's callbacks on.
import { MedusaError } from "@medusajs/framework/utils"

export const PUBLIC_SANDBOX = {
  paymentMerchantId: "3002607",
  logisticsMerchantId: "2000933",
} as const

export function assertPublicSandboxDrill(env: NodeJS.ProcessEnv = process.env): void {
  const refuse = (why: string) => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `ecpay-public-drill refused: ${why}`)
  }
  if (env.ECPAY_ENV !== "stage") refuse("ECPAY_ENV must be stage")
  if (env.ECPAY_MERCHANT_ID !== PUBLIC_SANDBOX.paymentMerchantId) {
    refuse(`ECPAY_MERCHANT_ID must be ECPay's public sandbox merchant ${PUBLIC_SANDBOX.paymentMerchantId}`)
  }
  if (env.ECPAY_LOGISTICS_MERCHANT_ID !== PUBLIC_SANDBOX.logisticsMerchantId) {
    refuse(`ECPAY_LOGISTICS_MERCHANT_ID must be ECPay's public C2C sandbox merchant ${PUBLIC_SANDBOX.logisticsMerchantId}`)
  }
  if (!/^https:\/\/[^/]+/.test(env.MEDUSA_BACKEND_URL ?? "")) {
    refuse("MEDUSA_BACKEND_URL must be a public https:// URL")
  }
}
