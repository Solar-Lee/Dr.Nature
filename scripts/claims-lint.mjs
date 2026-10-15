#!/usr/bin/env node
// Scans customer-facing text for wording banned under TW food-advertising rules.
// Rules live in docs/compliance/claims.json; see docs/compliance/claims.md.
//
// Usage: node scripts/claims-lint.mjs [path ...]
//   With no paths it scans DEFAULT_TARGETS. Exit 1 on any "error" hit, 0 otherwise.
//   "warn" rules are printed but never fail the run.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RULES_PATH = join(ROOT, "docs/compliance/claims.json");
// Where customer-facing copy lives (CC-07: the storefront has no src/; its copy is in lib/, content/
// and app/). A missing path is skipped silently by lintPaths, so a test asserts each one exists.
export const DEFAULT_TARGETS = ["content", "apps/storefront/lib", "apps/storefront/content", "apps/storefront/app"];
const TEXT_EXT = new Set([".md", ".mdx", ".json", ".ts", ".tsx", ".js", ".jsx", ".html", ".txt", ".yml", ".yaml"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".medusa", "dist", "coverage", "__tests__", "test", "tests"]);

export function loadRules(path = RULES_PATH) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw.banned) || raw.banned.length === 0) {
    throw new Error(`claims rules at ${path} have no banned terms`);
  }
  return {
    banned: raw.banned.map((r) => ({ term: r.term, reason: r.reason, src: r.src, level: r.level ?? "error" })),
    disclaimers: raw.disclaimer_allowlist ?? [],
  };
}

// Returns [{ line, column, term, reason, level }] for one string of text.
export function lintText(text, rules) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((original, i) => {
    let line = original;
    // Exact allow-listed disclaimer sentences are blanked out (same length) so
    // their words don't trip the scan but surrounding text still does.
    for (const d of rules.disclaimers) {
      line = line.split(d).join("　".repeat(d.length));
    }
    for (const rule of rules.banned) {
      let from = 0;
      let idx;
      while ((idx = line.indexOf(rule.term, from)) !== -1) {
        hits.push({ line: i + 1, column: idx + 1, term: rule.term, reason: rule.reason, level: rule.level });
        from = idx + rule.term.length;
      }
    }
  });
  return hits;
}

function* walk(path) {
  const st = statSync(path);
  if (st.isFile()) {
    if (TEXT_EXT.has(extname(path))) yield path;
    return;
  }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    yield* walk(join(path, name));
  }
}

export function lintPaths(paths, rules) {
  const results = [];
  for (const p of paths) {
    const abs = p.startsWith("/") ? p : join(ROOT, p);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      for (const hit of lintText(readFileSync(file, "utf8"), rules)) {
        results.push({ file: relative(ROOT, file), ...hit });
      }
    }
  }
  return results;
}

function main() {
  const rules = loadRules();
  const targets = process.argv.slice(2);
  const results = lintPaths(targets.length ? targets : DEFAULT_TARGETS, rules);
  const errors = results.filter((r) => r.level === "error");
  for (const r of results) {
    const tag = r.level === "error" ? "ERROR" : "warn ";
    console.log(`${tag} ${r.file}:${r.line}:${r.column}  「${r.term}」 ${r.reason}`);
  }
  console.log(`claims-lint: ${errors.length} error(s), ${results.length - errors.length} warning(s)`);
  process.exit(errors.length > 0 ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
