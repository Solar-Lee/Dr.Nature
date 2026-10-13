// POSTs a signed form to ECPay logistics (P4-11). Never throws. Three outcomes:
//  - ok:        ECPay answered "1|OK";
//  - refused:   ECPay answered "0|<reason>" (e.g. 「0|新取貨門市代碼與舊取貨門市代碼相同。」, stage
//               2026-10-13) — nothing happened at ECPay;
//  - uncertain: no answer, a timeout, a 5xx or a body in neither form — ECPay may have applied
//               the change, so callers alert staff instead of reporting a refusal (review
//               logistics-3).
import type { EcpayLogisticsOptions } from "./config"
import { isOkReply } from "./logistics"

export type LogisticsReply = { ok: true } | { ok: false; uncertain: boolean; message: string }

export async function postLogistics(options: EcpayLogisticsOptions, path: string, fields: Record<string, string>): Promise<LogisticsReply> {
  try {
    const res = await fetch(`${options.apiHost}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.text()).trim()
    if (isOkReply(body)) {
      return { ok: true }
    }
    if (/^0\|/.test(body)) {
      return { ok: false, uncertain: false, message: body.slice(2, 202) || "refused" }
    }
    return { ok: false, uncertain: true, message: `unexpected answer (HTTP ${res.status}): ${body.slice(0, 100)}` }
  } catch (e) {
    return { ok: false, uncertain: true, message: `no answer (${(e as Error).message})` }
  }
}
