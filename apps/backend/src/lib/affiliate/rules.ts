// [P9-01] Affiliate stores (/s/<slug>) and cart attribution: the pure rules, shared by the routes,
// the order.placed subscriber and the GMV export. Policy: docs/strategy/affiliate.md.
//
// Attribution lives in cart.metadata.affiliate = { store_id, partner_id, slug, attributed_at },
// written only by POST /store/carts/:id/affiliate. Medusa 2.21.2 copies cart.metadata whole onto
// the order (core-flows complete-cart.js, cartToOrder), so it reaches order.metadata.affiliate.
// Shoppers can write cart.metadata through POST /store/carts and POST /store/carts/:id
// (StoreCreateCart / StoreUpdateCart accept any record; the cart module merges it shallowly,
// "" deletes a key, and null or {} replace the whole object: medusa-internal-service.js update,
// merge-metadata.js), so those routes refuse the reserved keys and the wiping forms
// (cartMetadataProblem, src/api/middlewares.ts).
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

export const ATTRIBUTION_KEY = "affiliate"
export const DROPPED_KEY = "affiliate_dropped"

// Lower-case letters, digits and single hyphens; 3-48 characters; no hyphen at either end.
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,46}[a-z0-9]$/

export const normalizeSlug = (raw: unknown): string => String(raw ?? "").trim().toLowerCase()

export type StoreRow = {
  id: string
  slug: string
  title?: string
  status: string
  starts_at: string | Date
  ends_at: string | Date
  partner_id?: string | null
  partner?: { id: string; status: string; display_name?: string } | null
  product_ids?: string[] | null
  price_list_id?: string | null
}

export type StoreProblem = "draft" | "ended" | "not_started" | "expired" | "partner_inactive"

// Why a store does not take shoppers at `at` (null = it does). The window is [starts_at, ends_at),
// the same rule as promotion campaigns (src/lib/pricing/cart-promotions.ts isLive).
export function storeProblem(store: StoreRow, at: Date): StoreProblem | null {
  if (store.status === "draft") return "draft"
  if (store.status !== "active") return "ended"
  if (at < new Date(store.starts_at)) return "not_started"
  if (at >= new Date(store.ends_at)) return "expired"
  if (store.partner?.status !== "active") return "partner_inactive"
  return null
}

export type Attribution = { store_id: string; partner_id: string; slug: string; attributed_at: string }

// Extra keys (verified_at, added when the order is placed) are dropped, not refused.
const ATTRIBUTION = z.object({
  store_id: z.string().min(1),
  partner_id: z.string().min(1),
  slug: z.string().min(1),
  attributed_at: z.iso.datetime({ offset: true }),
})

export function parseAttribution(raw: unknown): Attribution | null {
  const r = ATTRIBUTION.safeParse(raw)
  return r.success ? r.data : null
}

export const attributionFor = (store: StoreRow & { partner_id: string }, at: Date): Attribution => ({
  store_id: store.id,
  partner_id: store.partner_id,
  slug: store.slug,
  attributed_at: at.toISOString(),
})

export type AttributionProblem = "malformed" | "store_missing" | "store_mismatch" | StoreProblem

// Is a recorded attribution genuine and was its store open at `at` (the order's placement)?
// store: the store with id attribution.store_id (with its partner), undefined when not found.
export function attributionProblem(raw: unknown, store: StoreRow | undefined, at: Date): AttributionProblem | null {
  const att = parseAttribution(raw)
  if (!att) return "malformed"
  if (!store) return "store_missing"
  if (store.partner_id !== att.partner_id || store.slug !== att.slug) return "store_mismatch"
  return storeProblem(store, at)
}

// Shopper-written cart metadata (POST /store/carts, POST /store/carts/:id). Keys "affiliate" and
// "affiliate_*" are the system's; null or {} would replace the whole metadata (and so erase the
// attribution) on update. Returns the refusal message, or null.
export function cartMetadataProblem(body: unknown, mode: "create" | "update"): string | null {
  if (!body || typeof body !== "object" || !("metadata" in body)) return null
  const metadata = (body as { metadata?: unknown }).metadata
  if (metadata === undefined) return null
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return mode === "update" ? "metadata cannot be cleared as a whole; set a key to \"\" to remove it" : null
  }
  const keys = Object.keys(metadata)
  if (!keys.length && mode === "update") {
    return "metadata cannot be cleared as a whole; set a key to \"\" to remove it"
  }
  const reserved = keys.filter((k) => k === ATTRIBUTION_KEY || k.startsWith(`${ATTRIBUTION_KEY}_`))
  return reserved.length ? `metadata key(s) reserved for affiliate attribution: ${reserved.join(", ")}` : null
}

// ---- admin input -------------------------------------------------------------------------

const TEXT = z.string().trim().min(1).max(80)
const IG = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9._]{1,30}$/, "ig_handle: an Instagram user name")
  .transform((s) => s.replace(/^@/, ""))
const KOL_ID = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "tuangou_kol_id: 1-64 letters, digits, - or _")
const SLUG = z
  .string()
  .transform(normalizeSlug)
  .refine((s) => SLUG_RE.test(s), "slug: 3-48 lower-case letters, digits or single hyphens, no hyphen at either end")
const WHEN = z.iso.datetime({ offset: true })
const PRODUCT_IDS = z.array(z.string().min(1)).min(1).max(50)

export const PARTNER_CREATE = z
  .object({
    display_name: TEXT,
    tuangou_kol_id: KOL_ID.nullish(),
    ig_handle: IG.nullish(),
    status: z.enum(["active", "inactive"]).default("active"),
  })
  .strict()

export const PARTNER_UPDATE = z
  .object({
    display_name: TEXT.optional(),
    tuangou_kol_id: KOL_ID.nullish(),
    ig_handle: IG.nullish(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict()

export const windowOk = (w: { starts_at?: string | Date; ends_at?: string | Date }) =>
  !w.starts_at || !w.ends_at || new Date(w.starts_at) < new Date(w.ends_at)

export const STORE_CREATE = z
  .object({
    partner_id: z.string().min(1),
    slug: SLUG,
    title: TEXT,
    product_ids: PRODUCT_IDS,
    starts_at: WHEN,
    ends_at: WHEN,
    status: z.enum(["draft", "active", "ended"]).default("draft"),
  })
  .strict()
  .refine(windowOk, "starts_at must be before ends_at")

// partner_id never changes (attributions carry it); slug only while the store is a draft (links
// with it may already be out), checked by the route.
export const STORE_UPDATE = z
  .object({
    slug: SLUG.optional(),
    title: TEXT.optional(),
    product_ids: PRODUCT_IDS.optional(),
    starts_at: WHEN.optional(),
    ends_at: WHEN.optional(),
    status: z.enum(["draft", "active", "ended"]).optional(),
  })
  .strict()

// Validates a request body; INVALID_DATA (400) naming every bad field.
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const r = schema.safeParse(body ?? {})
  if (!r.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")
    )
  }
  return r.data
}
