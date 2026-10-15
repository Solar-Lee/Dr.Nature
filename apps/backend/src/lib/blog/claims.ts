// [P6-01] Compliance gate for blog copy (docs/compliance/claims.md; 食安法 §28、健康食品管理法).
// Same rules and the same matching as scripts/claims-lint.mjs: rules come from
// src/data/claims.json, a copy of docs/compliance/claims.json kept identical by
// scripts/sync-catalog.mjs --check (test-all "catalog-sync"); a unit test compares this matcher
// with claims-lint.mjs on the same texts. Semantics (claims-lint lintText):
//  - text is checked line by line (\r?\n); exact allow-listed disclaimer sentences are blanked
//    first (same length), so their words do not count but the rest of the line still does;
//  - every occurrence of every banned term is a hit (plain substring, no word boundaries);
//  - level "error" (the default) blocks; "warn" is reported only.
import { MedusaError } from "@medusajs/framework/utils"
import claimsJson from "../../data/claims.json"

export type ClaimLevel = "error" | "warn"
export type ClaimRule = { term: string; reason: string; src?: string; level: ClaimLevel }
export type ClaimRules = { banned: ClaimRule[]; disclaimers: string[] }
export type ClaimHit = { line: number; column: number; term: string; reason: string; level: ClaimLevel }
export type FieldClaimHit = ClaimHit & { field: string }

type RawRules = { banned?: { term: string; reason: string; src?: string; level?: string }[]; disclaimer_allowlist?: string[] }

export function loadClaimRules(raw: RawRules = claimsJson as RawRules): ClaimRules {
  if (!Array.isArray(raw.banned) || raw.banned.length === 0) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "claims rules have no banned terms")
  }
  return {
    banned: raw.banned.map((r) => ({ term: r.term, reason: r.reason, src: r.src, level: (r.level ?? "error") as ClaimLevel })),
    disclaimers: raw.disclaimer_allowlist ?? [],
  }
}

export function lintText(text: string, rules: ClaimRules): ClaimHit[] {
  const hits: ClaimHit[] = []
  text.split(/\r?\n/).forEach((original, i) => {
    let line = original
    for (const d of rules.disclaimers) {
      line = line.split(d).join("　".repeat(d.length))
    }
    for (const rule of rules.banned) {
      let from = 0
      let idx: number
      while ((idx = line.indexOf(rule.term, from)) !== -1) {
        hits.push({ line: i + 1, column: idx + 1, term: rule.term, reason: rule.reason, level: rule.level })
        from = idx + rule.term.length
      }
    }
  })
  return hits
}

// Hits per named field (null / undefined fields are skipped).
export function lintFields(fields: Record<string, string | null | undefined>, rules: ClaimRules): FieldClaimHit[] {
  return Object.entries(fields).flatMap(([field, text]) =>
    typeof text === "string" ? lintText(text, rules).map((h) => ({ field, ...h })) : []
  )
}

// Thrown when customer-facing blog text contains a blocking ("error") term. Routes answer
// 400 with the offending terms (src/api/admin/blog/respond.ts).
export class BlogClaimsError extends Error {
  readonly terms: string[]
  readonly hits: FieldClaimHit[]
  constructor(hits: FieldClaimHit[]) {
    const terms = [...new Set(hits.map((h) => h.term))]
    super(`內容含不得使用的字詞，不能發佈：${terms.join("、")}（docs/compliance/claims.md）`)
    this.name = "BlogClaimsError"
    this.terms = terms
    this.hits = hits
  }
}

let cached: ClaimRules | undefined
const rulesOnce = () => (cached ??= loadClaimRules())

// Throws BlogClaimsError when any field has a blocking term.
export function assertNoBannedClaims(fields: Record<string, string | null | undefined>, rules: ClaimRules = rulesOnce()): void {
  const blocking = lintFields(fields, rules).filter((h) => h.level === "error")
  if (blocking.length) {
    throw new BlogClaimsError(blocking)
  }
}
