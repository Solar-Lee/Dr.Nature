#!/usr/bin/env node
// Copies single-source data files into the backend so compiled backend code can import them:
//  - content/products/catalog.json -> apps/backend/src/data/catalog.json (migration scripts)
//  - docs/compliance/claims.json   -> apps/backend/src/data/claims.json  (P6-01 blog publish gate;
//    the same rules scripts/claims-lint.mjs reads)
// Usage: node scripts/sync-catalog.mjs [--check] [--root <dir>]
// --check exits 1 when any copy is stale (or missing) instead of writing it.
// --root points the script at another tree (used by the tests with fixtures).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootArg = process.argv.indexOf("--root");
const ROOT = rootArg >= 0 ? process.argv[rootArg + 1] : join(dirname(fileURLToPath(import.meta.url)), "..");
if (!ROOT) {
  console.error("sync-catalog: --root needs a directory");
  process.exit(2);
}

export const COPIES = [
  ["content/products/catalog.json", "apps/backend/src/data/catalog.json"],
  ["docs/compliance/claims.json", "apps/backend/src/data/claims.json"],
];

const check = process.argv.includes("--check");
let stale = 0;
for (const [src, dest] of COPIES) {
  const source = readFileSync(join(ROOT, src), "utf8");
  const destPath = join(ROOT, dest);
  const current = existsSync(destPath) ? readFileSync(destPath, "utf8") : null;
  if (check) {
    if (current !== source) {
      console.error(`sync-catalog: ${dest} is stale (source ${src}); run node scripts/sync-catalog.mjs`);
      stale++;
    }
    continue;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, source);
  console.log(`sync-catalog: wrote ${dest}`);
}
if (check) {
  if (stale) process.exit(1);
  console.log(`sync-catalog: ${COPIES.length} copies up to date`);
}
