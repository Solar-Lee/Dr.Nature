// [P6-01] The blog publish gate must flag exactly what scripts/claims-lint.mjs flags: same rules
// (backend copy src/data/claims.json vs docs/compliance/claims.json) and same matching.
// Cannot prove: that claims.json itself is complete or legally sufficient (docs/compliance/claims.md).
import { execFileSync } from "child_process"
import { readFileSync } from "fs"
import { join } from "path"
import { BlogClaimsError, assertNoBannedClaims, lintFields, lintText, loadClaimRules } from "../claims"

const ROOT = join(__dirname, "../../../../../..")
const LINT = join(ROOT, "scripts/claims-lint.mjs")

// lintText of scripts/claims-lint.mjs (rules from docs/compliance/claims.json) on each text.
function lintWithScript(texts: string[]): unknown[] {
  const code = `
    import { loadRules, lintText } from ${JSON.stringify(LINT)};
    const rules = loadRules();
    const texts = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(texts.map((t) => lintText(t, rules))));
  `
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code, JSON.stringify(texts)], { encoding: "utf8" }))
}

const rules = loadClaimRules()
const DISCLAIMER = rules.disclaimers[0]

const SAMPLES = [
  "",
  "每天一點好菌，幫助消化。",
  "改善便秘，便秘不再來。\n第二行提到治療與免疫",
  `前文便秘${DISCLAIMER}後文過敏`,
  `${DISCLAIMER}`,
  "晶亮的眼神",
  "windows\r\n行尾便秘\r\n",
  "抵抗力抵抗力抵抗力",
]

describe("blog claims gate", () => {
  it("the backend copy of the rules equals docs/compliance/claims.json", () => {
    const copy = readFileSync(join(__dirname, "../../../data/claims.json"), "utf8")
    const source = readFileSync(join(ROOT, "docs/compliance/claims.json"), "utf8")
    expect(copy).toEqual(source)
  })

  it("flags the same hits as scripts/claims-lint.mjs on every sample", () => {
    expect(DISCLAIMER).toBeTruthy()
    const ours = SAMPLES.map((t) => lintText(t, rules))
    expect(ours).toEqual(lintWithScript(SAMPLES))
    // The samples really exercise the matcher: hits, repeats, a warn rule, a blanked disclaimer.
    expect(ours[2].map((h) => h.term)).toEqual(expect.arrayContaining(["便秘", "治療", "免疫"]))
    expect(ours[2].filter((h) => h.term === "便秘")).toHaveLength(2)
    expect(ours[3].map((h) => h.term).sort()).toEqual(["便秘", "過敏"].sort())
    expect(ours[4]).toEqual([])
    expect(ours[5].map((h) => h.level)).toEqual(["warn"])
    expect(ours[7]).toHaveLength(3)
  })

  it("lintFields names the field of each hit and skips empty fields", () => {
    const hits = lintFields({ title: "談便秘", excerpt: null, body_markdown: "ok", meta_description: undefined }, rules)
    expect(hits.map((h) => [h.field, h.term])).toEqual([["title", "便秘"]])
  })

  it("assertNoBannedClaims throws with the unique error terms only (warn does not block)", () => {
    expect(() => assertNoBannedClaims({ title: "晶亮", body_markdown: "幫助消化" })).not.toThrow()
    let error: unknown
    try {
      assertNoBannedClaims({ title: "便秘", body_markdown: "便秘與治療", meta_title: "晶亮" })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(BlogClaimsError)
    expect((error as BlogClaimsError).terms).toEqual(["便秘", "治療"])
    expect((error as BlogClaimsError).hits.map((h) => h.field)).toEqual(["title", "body_markdown", "body_markdown"])
  })

  it("rules without banned terms are refused", () => {
    expect(() => loadClaimRules({ banned: [] })).toThrow(/no banned terms/)
  })
})
