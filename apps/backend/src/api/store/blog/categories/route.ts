// [P6-01] Store: every blog category (id, name, slug), by name. -> { categories }
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listCategories } from "../../../../lib/blog/store"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({ categories: await listCategories(req.scope) })
}
