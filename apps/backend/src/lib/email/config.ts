// [P5-01 review auth-2] How e-mail (verification codes) is delivered. EMAIL_PROVIDER (docs/ENV.md):
//  - unset -> "none": no mail can be sent; e-mail verification requests answer 503 and staff get a
//    daily admin notice. In production this blocks emailpass / LINE sign-ups until U-09 (a
//    transactional e-mail provider) is chosen; Google sign-up still works.
//  - "log"  -> development / tests only: the verification link is written to the log. Refused in
//    production (it would log codes).
//  - anything else -> boot fails until the provider is implemented (U-09).
// Codes are never routed through Medusa's notification module: it persists `data`, shows it at
// GET /admin/notifications and notification-local logs it.
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

export type EmailDelivery = "none" | "log"

export function emailDeliveryFromEnv(env: NodeJS.ProcessEnv = process.env): EmailDelivery {
  const v = env.EMAIL_PROVIDER?.trim()
  if (!v) {
    return "none"
  }
  if (v === "log") {
    if (env.NODE_ENV === "production") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "EMAIL_PROVIDER=log must not be used in production")
    }
    return "log"
  }
  throw new MedusaError(MedusaError.Types.INVALID_DATA, `EMAIL_PROVIDER=${v}: not implemented yet (U-09)`)
}

// One admin feed notice per day; no code, no address.
export async function tellStaffEmailMissing(container: MedusaContainer) {
  const day = new Date().toISOString().slice(0, 10)
  await container
    .resolve(Modules.NOTIFICATION)
    .createNotifications({
      to: "",
      channel: "feed",
      template: "admin-ui",
      idempotency_key: `drn-email-missing-${day}`,
      data: {
        title: "會員驗證信無法寄出",
        description: "尚未設定寄信服務（EMAIL_PROVIDER，U-09）。用 Email 或 LINE 註冊的新會員無法完成註冊；Google 登入不受影響。",
      },
    })
    .catch((e: Error) => container.resolve(ContainerRegistrationKeys.LOGGER).error(`[EMAIL-ALERT] staff notice failed: ${e.message}`))
}
