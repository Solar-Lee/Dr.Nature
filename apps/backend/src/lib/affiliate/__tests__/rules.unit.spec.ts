// [P9-01] Affiliate store and attribution rules (src/lib/affiliate/rules.ts).
// Cannot prove: what Medusa does with the metadata (covered by integration-tests/http/affiliate.spec.ts).
import {
  PARTNER_CREATE,
  SLUG_RE,
  STORE_CREATE,
  STORE_UPDATE,
  attributionFor,
  attributionProblem,
  cartMetadataProblem,
  normalizeSlug,
  parseAttribution,
  parseBody,
  storeProblem,
  type StoreRow,
} from "../rules"

const T0 = new Date("2026-11-01T00:00:00+08:00")
const T1 = new Date("2026-11-15T00:00:00+08:00")
const store = (over: Partial<StoreRow> = {}): StoreRow => ({
  id: "astore_1",
  slug: "amy-nov",
  status: "active",
  starts_at: T0,
  ends_at: T1,
  partner_id: "apart_1",
  partner: { id: "apart_1", status: "active" },
  ...over,
})
const inside = new Date("2026-11-05T12:00:00+08:00")

describe("affiliate store rules", () => {
  it("slugs: lower-case letters, digits, single inner hyphens, 3-48 chars", () => {
    for (const ok of ["amy", "amy-nov", "a1-b2-c3", "x".repeat(48)]) expect(SLUG_RE.test(ok)).toBe(true)
    for (const bad of ["ab", "-amy", "amy-", "amy--nov", "Amy", "amy_nov", "amy nov", "x".repeat(49), "藥師"]) expect(SLUG_RE.test(bad)).toBe(false)
    expect(normalizeSlug("  AMY-Nov ")).toBe("amy-nov")
  })

  it("a store is open only while active, inside [starts_at, ends_at) and with an active partner", () => {
    expect(storeProblem(store(), inside)).toBeNull()
    expect(storeProblem(store(), T0)).toBeNull()
    expect(storeProblem(store(), new Date(T0.getTime() - 1))).toBe("not_started")
    expect(storeProblem(store(), T1)).toBe("expired")
    expect(storeProblem(store({ status: "draft" }), inside)).toBe("draft")
    expect(storeProblem(store({ status: "ended" }), inside)).toBe("ended")
    expect(storeProblem(store({ status: "weird" }), inside)).toBe("ended")
    expect(storeProblem(store({ partner: { id: "apart_1", status: "inactive" } }), inside)).toBe("partner_inactive")
    expect(storeProblem(store({ partner: null }), inside)).toBe("partner_inactive")
  })

  it("an attribution records store, partner, slug and time; parsing refuses anything incomplete", () => {
    const att = attributionFor({ ...store(), partner_id: "apart_1" }, inside)
    expect(att).toEqual({ store_id: "astore_1", partner_id: "apart_1", slug: "amy-nov", attributed_at: inside.toISOString() })
    expect(parseAttribution(att)).toEqual(att)
    expect(parseAttribution({ ...att, verified_at: "x" })).toEqual(att)
    expect(parseAttribution({ ...att, partner_id: "" })).toBeNull()
    expect(parseAttribution({ ...att, attributed_at: "yesterday" })).toBeNull()
    expect(parseAttribution("astore_1")).toBeNull()
    expect(parseAttribution(null)).toBeNull()
  })

  it("an attribution counts only when it matches its store and the store was open at placement", () => {
    const att = attributionFor({ ...store(), partner_id: "apart_1" }, inside)
    expect(attributionProblem(att, store(), inside)).toBeNull()
    expect(attributionProblem({ ...att, store_id: "" }, store(), inside)).toBe("malformed")
    expect(attributionProblem(att, undefined, inside)).toBe("store_missing")
    expect(attributionProblem({ ...att, partner_id: "apart_2" }, store(), inside)).toBe("store_mismatch")
    expect(attributionProblem({ ...att, slug: "bob-nov" }, store(), inside)).toBe("store_mismatch")
    expect(attributionProblem(att, store(), T1)).toBe("expired")
    expect(attributionProblem(att, store({ status: "ended" }), inside)).toBe("ended")
  })

  it("shopper cart metadata: affiliate keys and whole-object wipes are refused, other keys pass", () => {
    expect(cartMetadataProblem({ metadata: { affiliate: { store_id: "x" } } }, "update")).toMatch(/reserved/)
    expect(cartMetadataProblem({ metadata: { affiliate: "" } }, "update")).toMatch(/reserved/)
    expect(cartMetadataProblem({ metadata: { affiliate_dropped: {} } }, "create")).toMatch(/affiliate_dropped/)
    expect(cartMetadataProblem({ metadata: { note: "x", affiliate: 1 } }, "create")).toMatch(/affiliate/)
    expect(cartMetadataProblem({ metadata: null }, "update")).toMatch(/cleared/)
    expect(cartMetadataProblem({ metadata: {} }, "update")).toMatch(/cleared/)
    expect(cartMetadataProblem({ metadata: {} }, "create")).toBeNull()
    expect(cartMetadataProblem({ metadata: { ecpay_invoice_choice: { type: "member" }, affiliates: 1 } }, "update")).toBeNull()
    expect(cartMetadataProblem({ email: "a@b.c" }, "update")).toBeNull()
    expect(cartMetadataProblem(undefined, "update")).toBeNull()
  })

  it("admin input: slugs are normalised, windows ordered, unknown fields refused", () => {
    const s = parseBody(STORE_CREATE, {
      partner_id: "apart_1",
      slug: "AMY-Nov",
      title: "Amy 十一月團",
      product_ids: ["prod_1"],
      starts_at: "2026-11-01T00:00:00+08:00",
      ends_at: "2026-11-15T00:00:00+08:00",
    })
    expect(s).toMatchObject({ slug: "amy-nov", status: "draft" })
    const base = { partner_id: "p", slug: "amy", title: "t", product_ids: ["x"], starts_at: "2026-11-15T00:00:00+08:00" }
    expect(() => parseBody(STORE_CREATE, { ...base, ends_at: "2026-11-01T00:00:00+08:00" })).toThrow(/before/)
    expect(() => parseBody(STORE_CREATE, { ...base, ends_at: "2026-11-20T00:00:00+08:00", product_ids: [] })).toThrow(/product_ids/)
    expect(() => parseBody(STORE_CREATE, { ...base, ends_at: "2026-11-20T00:00:00+08:00", starts_at: "2026-11-15" })).toThrow(/starts_at/)
    expect(() => parseBody(STORE_UPDATE, { partner_id: "apart_2" })).toThrow(/partner_id/)
    expect(parseBody(PARTNER_CREATE, { display_name: "Amy", ig_handle: "@amy.tw" })).toEqual({ display_name: "Amy", ig_handle: "amy.tw", status: "active" })
    expect(() => parseBody(PARTNER_CREATE, { display_name: "Amy", tuangou_kol_id: "has space" })).toThrow(/tuangou_kol_id/)
  })
})
