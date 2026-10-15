// [P9-01] Store API side of affiliate stores: the group-buy storefront only (the publishable key's
// sales channels must include the group-buy channel). Shopper messages never say why a store is
// closed (draft, ended, out of its period, partner inactive): the answer is the same 404.
import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { storeProblem, type StoreRow } from "./rules"
import { groupBuyChannelId, storeBySlug } from "./store"

export const STORE_NOT_FOUND = "找不到這個賣場，或賣場活動已結束。"
export const GROUP_BUY_ONLY = "這個購物車不能使用團購賣場。"

const keyChannels = (req: MedusaRequest): string[] =>
  (req as MedusaRequest & { publishable_key_context?: { sales_channel_ids?: string[] } }).publishable_key_context?.sales_channel_ids ?? []

// The store behind `slug` when it is open now and the request comes from the group-buy storefront.
export async function openStoreForRequest(req: MedusaRequest, slug: unknown, now: Date): Promise<{ store: StoreRow; channelId: string }> {
  const channelId = await groupBuyChannelId(req.scope)
  const store = keyChannels(req).includes(channelId) ? await storeBySlug(req.scope, slug) : undefined
  if (!store || storeProblem(store, now)) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, STORE_NOT_FOUND)
  }
  return { store, channelId }
}

type CartRow = { id: string; sales_channel_id?: string | null; completed_at?: unknown; metadata?: Record<string, unknown> | null }

// An open (not completed) cart of the group-buy channel, asked for through a group-buy key.
export async function groupBuyCart(req: MedusaRequest, cartId: string): Promise<CartRow> {
  const { data } = await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "cart",
    fields: ["id", "sales_channel_id", "completed_at", "metadata"],
    filters: { id: cartId },
  })
  const cart = data[0] as CartRow | undefined
  if (!cart) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart id not found: ${cartId}`)
  }
  if (cart.completed_at) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "這筆購物車已經結帳。")
  }
  const channelId = await groupBuyChannelId(req.scope)
  if (cart.sales_channel_id !== channelId || !keyChannels(req).includes(channelId)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, GROUP_BUY_ONLY)
  }
  return cart
}
