// [P4-11 review logistics-1] What someone who is not the order's logged-in owner may see of an
// order. Medusa 2.21.2 serves an order by id alone (GET /store/orders/:id; the cart-complete
// response uses the same fields) and the id is not a secret (confirmation URLs, e-mails,
// analytics, screenshots). So for non-owners the e-mail, names, phones and street address are
// masked, the cart link is dropped (cart.id would open GET /store/carts/:id), and fulfillment /
// payment-session data are cut down to what a confirmation page needs (pickup store, status,
// ECPay payment instructions / checkout form). The e-mail is then a real second factor for the
// guest routes (cvs-store, repay; lib/order-owner.ts).
// Deny-list over Medusa's bounded allowed fields (medusa/dist/api/store/orders/query-config.js):
// re-audit on every Medusa upgrade (the order-privacy spec requests every allowed field).
type Obj = Record<string, any>

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v)
const chars = (s: string) => Array.from(s)

export const maskEmail = (v: unknown) => {
  if (typeof v !== "string" || !v) return v
  const at = v.lastIndexOf("@")
  return at > 0 ? `${chars(v)[0]}***${v.slice(at)}` : "***"
}
export const maskName = (v: unknown) => (typeof v === "string" && v ? chars(v)[0] + "○".repeat(Math.max(1, chars(v).length - 1)) : v)
export const maskPhone = (v: unknown) =>
  typeof v === "string" && v.length > 5 ? v.slice(0, 2) + "*".repeat(v.length - 5) + v.slice(-3) : v ? "***" : v
const hide = (v: unknown) => (v ? "***" : v)
const pick = (o: unknown, keys: string[]) => (isObj(o) ? Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]])) : o)

export const maskAddress = (a: unknown) =>
  isObj(a)
    ? {
        ...a,
        first_name: maskName(a.first_name),
        last_name: maskName(a.last_name),
        company: hide(a.company),
        phone: maskPhone(a.phone),
        address_1: hide(a.address_1),
        address_2: hide(a.address_2),
        metadata: null,
      }
    : a

export function maskOrder(order: unknown) {
  if (!isObj(order)) return order
  const o: Obj = { ...order }
  if ("email" in o) o.email = maskEmail(o.email)
  if (isObj(o.customer)) o.customer = { id: o.customer.id, ...("email" in o.customer ? { email: maskEmail(o.customer.email) } : {}) }
  delete o.cart
  for (const k of ["shipping_address", "billing_address"]) {
    if (k in o) o[k] = maskAddress(o[k])
  }
  const each = (k: string, f: (x: Obj) => Obj) => {
    if (Array.isArray(o[k])) o[k] = o[k].map((x: unknown) => (isObj(x) ? f(x) : x))
  }
  each("fulfillments", (f) => ({
    ...f,
    ...("data" in f ? { data: pick(f.data, ["store", "logistics_type", "logistics_subtype"]) } : {}),
    ...("metadata" in f ? { metadata: pick(f.metadata, ["ecpay_status"]) } : {}),
  }))
  each("shipping_methods", (m) => ("data" in m ? { ...m, data: pick(m.data, ["store", "logistics_type", "logistics_subtype"]) } : m))
  each("payment_collections", (pc) =>
    Array.isArray(pc.payment_sessions)
      ? {
          ...pc,
          payment_sessions: pc.payment_sessions.map((s: unknown) =>
            isObj(s) && "data" in s ? { ...s, data: pick(s.data, ["checkout_form", "ecpay_payment_instructions", "choose_payment", "amount"]) } : s
          ),
        }
      : pc
  )
  return o
}

// Bodies of GET /store/orders/:id ({ order }) and POST /store/carts/:id/complete ({ type, order }).
export const maskOrderBody = (b: unknown) => (isObj(b) && isObj(b.order) ? { ...b, order: maskOrder(b.order) } : b)
