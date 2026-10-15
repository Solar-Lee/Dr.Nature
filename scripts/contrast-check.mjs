#!/usr/bin/env node
// WCAG 2.2 contrast check for the colour pairs the storefront CSS puts next to each other.
//
// Usage: node scripts/contrast-check.mjs [apps/storefront/app/globals.css]
// Exit codes: 0 every judged pair passes; 1 at least one judged pair fails; 2 the CSS cannot be read
// or a token the table needs is missing (a load-time failure is also non-zero, so test-all goes red).
//
// Thresholds (WCAG 2.2, sRGB relative luminance, ratios compared without rounding):
//   text      >= 4.5:1  (1.4.3 contrast minimum, body-size text)
//   large     >= 3:1    (1.4.3, text >= 24px or >= 18.66px bold)
//   non-text  >= 3:1    (1.4.11, UI component boundaries, focus indicators, state indicators)
//   exempt    printed, never judged: 1.4.3/1.4.11 exceptions (disabled controls, pure decoration,
//             logotype) and rows kept for information only.
// Sources: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
//          https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
//
// Token values are read from the first :root block of the CSS, so the table follows the live tokens
// (a token may point at another token with var(--x)). Literals that are not tokens yet are written
// out here next to the rule they come from, so moving one into a token means editing both places.
//
// What this check cannot prove: it judges declared colour pairs, not rendered pixels. Gradients are
// sampled at their declared stops (and one midpoint), alpha is blended by hand, and anything drawn
// on a canvas (Bottle3D.tsx) or set inline in a .tsx file is listed for information only.
import fs from "node:fs";
import path from "node:path";

const cssPath = process.argv[2] || path.join("apps", "storefront", "app", "globals.css");
let css;
try {
  css = fs.readFileSync(cssPath, "utf8");
} catch (e) {
  console.error(`contrast-check: cannot read ${cssPath}: ${e.message}`);
  process.exit(2);
}

// ---- tokens -------------------------------------------------------------------------------------
const rootBlock = css.match(/:root\s*\{([^}]*)\}/);
if (!rootBlock) {
  console.error(`contrast-check: no :root block in ${cssPath}`);
  process.exit(2);
}
const raw = {};
for (const m of rootBlock[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) raw[m[1]] = m[2].trim();

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const resolve = (name, seen = []) => {
  if (seen.includes(name)) throw new Error(`token loop: ${[...seen, name].join(" -> ")}`);
  const val = raw[name];
  if (val === undefined) throw new Error(`token --${name} is not defined in :root of ${cssPath}`);
  const ref = val.match(/^var\(--([a-z0-9-]+)\)$/);
  if (ref) return resolve(ref[1], [...seen, name]);
  if (!HEX.test(val)) throw new Error(`token --${name} is not a hex colour: ${val}`);
  return val.toLowerCase();
};
const t = (name) => {
  try {
    return resolve(name);
  } catch (e) {
    console.error(`contrast-check: ${e.message}`);
    process.exit(2);
  }
};

// ---- colour maths (WCAG 2.2 relative luminance) -------------------------------------------------
const hex = (h) => {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const L = (h) => {
  const [r, g, b] = hex(h);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// fg at opacity a over bg
const blend = (fg, bg, a) => {
  const f = hex(fg), g = hex(bg);
  return "#" + f.map((v, i) => Math.round(v * a + g[i] * (1 - a)).toString(16).padStart(2, "0")).join("");
};
// linear-gradient colour between two stops, frac in [0,1]
const mix = (a, b, frac) => blend(b, a, frac);

// ---- pairs: [label, foreground, background, kind] -----------------------------------------------
// kind: "text" | "large" | "non-text" | "exempt: <reason>"
const WHITE = "#ffffff";
const DARK = t("ink-dark"); // .dark / .dark .stairs span
const DARK_SLOT = "#2a2a2a"; // .inline-slot background
const SURFACE = "#ffffff"; // inputs and card stage highlight (L1041, L1319, L910, L1156)
const SURFACE_2 = "#fbfbf9"; // .label-table / .rd-name / .soon (L1190, L1238, L1299)
const HOVER = "#f6f5f2"; // .pcard:hover / .jcard:hover (L892, L986)
const panelStops = [t("ink-dark"), t("ink-dark-2"), t("ink-dark-3")]; // .panel-dark gradient 0% / 70% / 100%

const pairs = [
  // body and secondary text
  ["body: ink on paper (L34-35)", t("ink"), t("paper"), "text"],
  ["muted / lede / .en: ink-2 on paper (L91, L95, L114)", t("ink-2"), t("paper"), "text"],
  ["label-table dt: ink-2 on surface-2 (L1190, L1205)", t("ink-2"), SURFACE_2, "text"],
  ["slot placeholder: ink-2 12px on paper-2 (L382-388)", t("ink-2"), t("paper-2"), "text"],
  ["pending-list text: ink-2 12.5px on paper (L1218-1222)", t("ink-2"), t("paper"), "text"],
  ["footer legal: ink-2 12px on paper (L1107-1113)", t("ink-2"), t("paper"), "text"],
  ["tabs a: ink-2 12.5px on paper (L687-690)", t("ink-2"), t("paper"), "text"],
  ["sidenav story a: ink-2 13.5px on paper (L301-303)", t("ink-2"), t("paper"), "text"],
  ["sidenav story-head: ink-2 11px on paper (L294-297)", t("ink-2"), t("paper"), "text"],
  ["notice / skip: paper on ink (L138-140, L58-59)", t("paper"), t("ink"), "text"],
  // red accent as text: small type uses --red-2; --red stays for fills, the wordmark dot and rails
  ["kicker: red-2 12px bold on paper (.kicker)", t("red-2"), t("paper"), "text"],
  ["ptag: red-2 11.5px on paper (.ptag)", t("red-2"), t("paper"), "text"],
  ["jcard .cat: red-2 11.5px bold on paper (.jcard .cat)", t("red-2"), t("paper"), "text"],
  ["jcard .cat on hover: red-2 on #f6f5f2 (.jcard:hover)", t("red-2"), "#f6f5f2", "text"],
  ["hero-meta b: red-2 12px on paper (.hero-meta b)", t("red-2"), t("paper"), "text"],
  ["story pillar numerals: red inline (story/page.tsx:79, lane D moves it to red-2)", t("red"), t("paper"), "exempt: info (inline .tsx colour)"],
  ["wordmark dot: red 22px bold on paper (.dot)", t("red"), t("paper"), "large"],
  // buttons
  ["btn: white on red (L330-331)", WHITE, t("red"), "text"],
  ["btn:hover: white on red-2 (L340-341)", WHITE, t("red-2"), "text"],
  ["btn disabled: ink-2 on paper-2 (L359-361)", t("ink-2"), t("paper-2"), "exempt: disabled control (1.4.3)"],
  ["btn.light border: white on panel-dark end stop (.btn.light, .panel-dark)", WHITE, panelStops[2], "non-text"],
  // hero caption over the stage gradient (.hero-video .tag, full opacity)
  ["hero-video tag: ink-2 on paper-2 (.hero-video .tag)", t("ink-2"), t("paper-2"), "text"],
  ["hero-video tag: ink-2 on #f7f6f3 (.hero-video .tag)", t("ink-2"), "#f7f6f3", "text"],
  ["hero-video tag: ink-2 on #dddbd5 gradient end (.hero-video .tag)", t("ink-2"), "#dddbd5", "text"],
  // 02 dark section
  ["dark: #f1f0ec on ink-dark (.dark)", "#f1f0ec", DARK, "text"],
  ["dark .dim resting: ink-dim on ink-dark, judged as body text (.dark .dim)", t("ink-dim"), DARK, "text"],
  ["dark .dim reduced motion: paper on ink-dark (.dark .dim)", t("paper"), DARK, "text"],
  ["inline-slot border: line-dark on ink-dark (.inline-slot)", t("line-dark"), DARK, "non-text"],
  ["inline-slot border: line-dark on its own fill #2a2a2a (.inline-slot)", t("line-dark"), DARK_SLOT, "non-text"],
  ["inline-slot fill: #2a2a2a on ink-dark (.inline-slot)", DARK_SLOT, DARK, "exempt: decorative placeholder"],
  // 06 dark panel (gradient sampled at its stops and the midpoint of each segment)
  ["panel-dark: white on top stop (.panel-dark)", WHITE, panelStops[0], "text"],
  ["panel-dark: white on top-mid midpoint (.panel-dark)", WHITE, mix(panelStops[0], panelStops[1], 0.5), "text"],
  ["panel-dark: white on mid stop (.panel-dark)", WHITE, panelStops[1], "text"],
  ["panel-dark: white on end stop (.panel-dark)", WHITE, panelStops[2], "text"],
  ["panel-dark: white on mid-end midpoint (.panel-dark)", WHITE, mix(panelStops[1], panelStops[2], 0.5), "text"],
  ["panel-dark kicker: #e8e7e2 on every stop, worst = end (.panel-dark .kicker)", "#e8e7e2", panelStops[2], "text"],
  // forms
  ["input placeholder: ink-2 on surface (.input::placeholder)", t("ink-2"), SURFACE, "text"],
  ["input:disabled text: ink-2 on surface (.input:disabled)", t("ink-2"), SURFACE, "exempt: disabled control (1.4.3)"],
  ["nl input border: line-strong on surface, inside (.input / .nl input)", t("line-strong"), SURFACE, "non-text"],
  ["nl input border: line-strong on paper, outside (.contact)", t("line-strong"), t("paper"), "non-text"],
  ["soon input border: line-strong on surface-2, outside (.soon)", t("line-strong"), SURFACE_2, "non-text"],
  ["pending-list dashed border: line-strong on paper (.pending-list li)", t("line-strong"), t("paper"), "non-text"],
  // focus indicator (2px outline, L49-51) on every surface it can land on
  ["focus ring: red on paper (L49-50)", t("red"), t("paper"), "non-text"],
  ["focus ring: red on surface (L49-50)", t("red"), SURFACE, "non-text"],
  ["focus ring: white on ink-dark (.dark :focus-visible)", WHITE, DARK, "non-text"],
  ["focus ring: white on panel-dark top stop (.panel-dark :focus-visible)", WHITE, panelStops[0], "non-text"],
  ["focus ring: white on panel-dark mid stop (.panel-dark :focus-visible)", WHITE, panelStops[1], "non-text"],
  ["focus ring: white on panel-dark end stop (.panel-dark :focus-visible)", WHITE, panelStops[2], "non-text"],
  // state indicators
  ["tabs rail active: red on paper (L697-704, L712-713)", t("red"), t("paper"), "non-text"],
  ["jtabs active underline: red on paper (L955-958)", t("red"), t("paper"), "non-text"],
  ["sidenav current dot: red on paper (L285-289)", t("red"), t("paper"), "non-text"],
  // decorative and informational rows (never judged)
  ["hairline: line on paper (L133-134)", t("line"), t("paper"), "exempt: decorative (1.4.11)"],
  ["tabs rail inactive: line on paper (L692)", t("line"), t("paper"), "exempt: decorative track; active state is the red rail"],
  ["sitemap underline: line on paper (L1096-1099)", t("line"), t("paper"), "exempt: decorative; link text is ink"],
  ["pcard/jcard hover: #f6f5f2 vs paper (L892, L986)", HOVER, t("paper"), "exempt: info (hover perceptibility)"],
  ["3D label small text: #8a8a86 on #fcfcfa (Bottle3D.tsx:45-47)", "#8a8a86", "#fcfcfa", "exempt: info (canvas texture, not CSS)"],
];

// ---- judge ---------------------------------------------------------------------------------------
const need = (kind) => (kind === "text" ? 4.5 : kind === "large" || kind === "non-text" ? 3 : 0);
const rows = pairs.map(([label, fg, bg, kind]) => {
  if (!HEX.test(fg) || !HEX.test(bg)) {
    console.error(`contrast-check: bad colour in "${label}": ${fg} / ${bg}`);
    process.exit(2);
  }
  const r = ratio(fg, bg);
  const min = need(kind);
  return { label, fg, bg, kind, ratio: +r.toFixed(2), need: min || "-", result: min ? (r >= min ? "PASS" : "FAIL") : "-" };
});
console.table(rows);
const failing = rows.filter((r) => r.result === "FAIL");
const judged = rows.filter((r) => r.result !== "-").length;
console.log(`contrast-check: ${rows.length} pairs, ${judged} judged, ${failing.length} failing (${cssPath})`);
for (const r of failing) console.log(`  FAIL ${r.ratio}:1 < ${r.need}:1  ${r.label}`);
process.exit(failing.length ? 1 : 0);
