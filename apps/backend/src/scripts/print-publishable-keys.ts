// Prints the publishable API keys the storefronts need (NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY).
// Publishable keys are public by design, but output stays redacted unless `reveal` is passed,
// so the token is not left in shared logs by accident. `medusa exec` passes positional
// args only (`exec [file] [args..]`), so the flag is the bare word `reveal`. Usage (from apps/backend):
//   pnpm exec medusa exec ./src/scripts/print-publishable-keys.ts [reveal]
import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { PUBLISHABLE_KEYS } from "../lib/drn-setup"

export default async function printPublishableKeys({ container, args }: ExecArgs) {
  const reveal = (args ?? []).includes("reveal")
  const apiKeyModule = container.resolve(Modules.API_KEY)
  const keys = await apiKeyModule.listApiKeys({
    title: Object.values(PUBLISHABLE_KEYS),
    type: "publishable",
  })
  for (const key of keys) {
    console.log(`${key.title}: ${reveal ? key.token : key.redacted}${key.revoked_at ? " (REVOKED)" : ""}`)
  }
}
