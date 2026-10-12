#!/usr/bin/env node
// Copies content/products/catalog.json (single source of truth) into the backend so the
// compiled migration scripts can import it. Usage: node scripts/sync-catalog.mjs [--check]
// --check exits 1 when the copy is stale instead of writing it.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "content/products/catalog.json");
const DEST = join(ROOT, "apps/backend/src/data/catalog.json");

const source = readFileSync(SRC, "utf8");
const current = existsSync(DEST) ? readFileSync(DEST, "utf8") : null;

if (process.argv.includes("--check")) {
  if (current !== source) {
    console.error("sync-catalog: apps/backend/src/data/catalog.json is stale; run node scripts/sync-catalog.mjs");
    process.exit(1);
  }
  console.log("sync-catalog: up to date");
  process.exit(0);
}
mkdirSync(dirname(DEST), { recursive: true });
writeFileSync(DEST, source);
console.log("sync-catalog: wrote apps/backend/src/data/catalog.json");
