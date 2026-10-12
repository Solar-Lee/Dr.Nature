// Probes ECPay stage's daily reconciliation file TradeNoAio (P4-07, developers.ecpay.com.tw/2896/)
// with this codebase's signing, and prints the CSV header and a few rows, so the parser is
// written against what ECPay really returns (the doc lists columns but not exact strings).
// Stage only; public sandbox merchant. Production requires the server IP to be whitelisted in
// the ECPay vendor back office. Usage (from apps/backend):
//   ../../infra/dev-env.sh pnpm exec medusa exec ./src/scripts/ecpay-tradenoaio-stage-probe.ts [YYYY-MM-DD] [V1|V2|V3]
import type { ExecArgs } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { ecpayOptionsFromEnv } from "../lib/ecpay/config"
import { buildTradeNoAioRequest, TRADENOAIO_HOSTS } from "../lib/ecpay/reconcile-file"

export default async function ecpayTradeNoAioStageProbe({ args }: ExecArgs) {
  const options = ecpayOptionsFromEnv()
  if (options.environment !== "stage") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "TradeNoAio probe runs only with ECPAY_ENV=stage")
  }
  const day = (args ?? [])[0] ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  const format = ((args ?? [])[1] ?? "V1") as "V1" | "V2" | "V3"
  for (const dateType of ["6", "2"] as const) {
    const fields = buildTradeNoAioRequest(
      { merchantId: options.merchantId, hashKey: options.hashKey, hashIV: options.hashIV },
      { dateType, begin: day, end: day, format }
    )
    const res = await fetch(TRADENOAIO_HOSTS.stage, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    })
    const buf = Buffer.from(await res.arrayBuffer())
    const text = buf.toString("utf8")
    const lines = text.split(/\r?\n/).filter(Boolean)
    console.log(JSON.stringify({
      dateType,
      day,
      format,
      http: res.status,
      content_type: res.headers.get("content-type"),
      bytes: buf.length,
      starts_with_bom: buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf,
      rows: lines.length,
      header: lines[0]?.slice(0, 600),
      first_rows: lines.slice(1, 3).map((l) => l.slice(0, 400)),
    }))
  }
}
