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
const DARK = "#1a1a1a"; // .dark / .dark .stairs span (globals.css L551, L580)
const DARK_SLOT = "#2a2a2a"; // .inline-slot background (L609)
const SURFACE = "#ffffff"; // inputs and card stage highlight (L1041, L1319, L910, L1156)
const SURFACE_2 = "#fbfbf9"; // .label-table / .rd-name / .soon (L1190, L1238, L1299)
const HOVER = "#f6f5f2"; // .pcard:hover / .jcard:hover (L892, L986)
const panelStops = ["#4a4a48", "#8a8a86", "#bdbcb8"]; // .panel-dark gradient (L845)

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
  // red accent as text
  ["kicker: red 12px bold on paper (L103-107)", t("red"), t("paper"), "text"],
  ["ptag / jcard .cat: red 11.5px on paper (L671-674, L991-994)", t("red"), t("paper"), "text"],
  ["hero-meta b: red 12px on paper (L460-462)", t("red"), t("paper"), "text"],
  ["wordmark dot: red 22px bold on paper (L124-126)", t("red"), t("paper"), "large"],
  // buttons
  ["btn: white on red (L330-331)", WHITE, t("red"), "text"],
  ["btn:hover: white on red-2 (L340-341)", WHITE, t("red-2"), "text"],
  ["btn disabled: ink-2 on paper-2 (L359-361)", t("ink-2"), t("paper-2"), "exempt: disabled control (1.4.3)"],
  ["btn.light border: white on panel-dark end stop (L354-357, L845)", WHITE, panelStops[2], "non-text"],
  // hero caption over the stage gradient (ink-2 at opacity .75, L494-496)
  ["hero-video tag: ink-2 @ .75 on paper-2 (L485, L494-496)", blend(t("ink-2"), t("paper-2"), 0.75), t("paper-2"), "text"],
  ["hero-video tag: ink-2 @ .75 on #f7f6f3 (L485, L494-496)", blend(t("ink-2"), "#f7f6f3", 0.75), "#f7f6f3", "text"],
  // 02 dark section
  ["dark: #f1f0ec on #1a1a1a (L551-552)", "#f1f0ec", DARK, "text"],
  ["dark .dim resting: #6f6f6b on #1a1a1a, h2 >= 28.8px bold (L561-562)", "#6f6f6b", DARK, "large"],
  ["inline-slot border: #555 on #1a1a1a (L608)", "#555555", DARK, "non-text"],
  ["inline-slot fill: #2a2a2a on #1a1a1a (L609)", DARK_SLOT, DARK, "exempt: decorative placeholder"],
  // 06 dark panel (gradient sampled at its stops and the midpoint of the last segment)
  ["panel-dark: white on top stop (L845-846)", WHITE, panelStops[0], "text"],
  ["panel-dark: white on mid stop (L845-846)", WHITE, panelStops[1], "text"],
  ["panel-dark: white on end stop (L845-846)", WHITE, panelStops[2], "text"],
  ["panel-dark: white on mid-end midpoint (L845-846)", WHITE, mix(panelStops[1], panelStops[2], 0.5), "text"],
  ["panel-dark kicker: #e8e7e2 on top stop (L852-853)", "#e8e7e2", panelStops[0], "text"],
  // forms
  ["nl input placeholder: #8a8a86 on surface (L1044-1045)", "#8a8a86", SURFACE, "text"],
  ["soon input:disabled: #8a8a86 on surface (L1321-1322)", "#8a8a86", SURFACE, "exempt: disabled control (1.4.3)"],
  ["nl input border: line on surface (L1040-1041)", t("line"), SURFACE, "non-text"],
  ["soon input border: line on surface (L1318-1319)", t("line"), SURFACE, "non-text"],
  ["pending-list dashed border: #9a9a96 on paper (L1221)", "#9a9a96", t("paper"), "non-text"],
  // focus indicator (2px outline, L49-51) on every surface it can land on
  ["focus ring: red on paper (L49-50)", t("red"), t("paper"), "non-text"],
  ["focus ring: red on surface (L49-50)", t("red"), SURFACE, "non-text"],
  ["focus ring: red on dark #1a1a1a (L49-50, L551)", t("red"), DARK, "non-text"],
  ["focus ring: red on panel-dark top stop (L49-50, L845)", t("red"), panelStops[0], "non-text"],
  ["focus ring: red on panel-dark mid stop (L49-50, L845)", t("red"), panelStops[1], "non-text"],
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
