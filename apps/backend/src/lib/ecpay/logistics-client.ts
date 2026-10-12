// POSTs a signed form to ECPay logistics and reports "1|OK" answers (P4-11). Never throws.
import type { EcpayLogisticsOptions } from "./config"
import { isOkReply } from "./logistics"

export async function postLogistics(options: EcpayLogisticsOptions, path: string, fields: Record<string, string>) {
  try {
    const res = await fetch(`${options.apiHost}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.text()).trim()
    // Failures look like "0|新取貨門市代碼與舊取貨門市代碼相同。" (seen on stage 2026-10-13).
    return isOkReply(body) ? { ok: true as const } : { ok: false as const, message: body.replace(/^0\|/, "").slice(0, 200) || `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false as const, message: `no answer (${(e as Error).message})` }
  }
}
