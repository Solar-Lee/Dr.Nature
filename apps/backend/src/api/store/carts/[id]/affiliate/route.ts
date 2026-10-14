// [P9-01] Cart attribution to an affiliate store (docs/strategy/affiliate.md).
//  POST   /store/carts/:id/affiliate { slug }: the store must be open now; records
//         cart.metadata.affiliate = { store_id, partner_id, slug, attributed_at } (a later store
//         replaces an earlier one: last click wins). Medusa copies it onto the order at completion;
//         the order.placed subscriber drops it there when the store was no longer open.
//  DELETE /store/carts/:id/affiliate: removes it.
// Group-buy carts and keys only. The generic cart routes cannot write these keys (middlewares.ts).
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { updateCartWorkflow } from "@medusajs/medusa/core-flows"
import { ATTRIBUTION_KEY, attributionFor, parseBody } from "../../../../../lib/affiliate/rules"
import { groupBuyCart, openStoreForRequest } from "../../../../../lib/affiliate/shopper"

const BODY = z.object({ slug: z.string().min(1).max(100) }).strict()

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { slug } = parseBody(BODY, req.body)
  const cart = await groupBuyCart(req, req.params.id)
  const now = new Date()
  const { store } = await openStoreForRequest(req, slug, now)
  const affiliate = attributionFor({ ...store, partner_id: store.partner_id as string }, now)
  await updateCartWorkflow(req.scope).run({ input: { id: cart.id, metadata: { [ATTRIBUTION_KEY]: affiliate } } })
  res.json({
    cart_id: cart.id,
    affiliate,
    store: { slug: store.slug, title: store.title, partner: { display_name: store.partner?.display_name ?? null } },
  })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const cart = await groupBuyCart(req, req.params.id)
  if (cart.metadata?.[ATTRIBUTION_KEY] !== undefined) {
    // "" deletes the key (Medusa mergeMetadata).
    await updateCartWorkflow(req.scope).run({ input: { id: cart.id, metadata: { [ATTRIBUTION_KEY]: "" } } })
  }
  res.json({ cart_id: cart.id, affiliate: null })
}
