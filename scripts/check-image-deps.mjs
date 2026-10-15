#!/usr/bin/env node
// [P12-03] Proves the backend image installed only versions pinned in pnpm-lock.yaml (deployment
// review C7; pnpm 9 `deploy --prod` builds a fresh tree, so this is checked, not assumed).
// Input on stdin: the directory names of /app/node_modules/.pnpm inside the image, one per line:
//   drn-docker run --rm --entrypoint ls drn-backend:<sha> /app/node_modules/.pnpm | node scripts/check-image-deps.mjs
// Parsing: skip `lock.yaml` and `node_modules`; the package name ends at the first "@" after the
// first character ("+" stands for "/" in scoped names); the version runs to the first "_" (peer
// suffix). name@version must be a key of the lockfile's `packages:` section.
// Prints "N packages, M not in lockfile"; exit 1 when M > 0 or the input is empty.
// Cannot prove: that package CONTENTS match the lockfile integrity hashes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const lockArg = process.argv.indexOf("--lockfile");
const lockPath = lockArg >= 0 ? process.argv[lockArg + 1] : join(dirname(fileURLToPath(import.meta.url)), "..", "pnpm-lock.yaml");
const lock = readFileSync(lockPath, "utf8");
const start = lock.search(/^packages:\s*$/m);
const end = lock.search(/^snapshots:\s*$/m);
if (start < 0) {
  console.error("check-image-deps: no packages: section in the lockfile");
  process.exit(1);
}
const section = lock.slice(start, end > start ? end : undefined);
const locked = new Set([...section.matchAll(/^  '?([^'\s][^']*?)'?:\s*$/gm)].map((m) => m[1]));

export function parseDir(dir) {
  if (dir === "lock.yaml" || dir === "node_modules") return null;
  const at = dir.indexOf("@", 1);
  if (at < 0) return { bad: dir };
  const name = dir.slice(0, at).replace("+", "/");
  const rest = dir.slice(at + 1);
  const us = rest.indexOf("_");
  const version = us < 0 ? rest : rest.slice(0, us);
  return { key: `${name}@${version}` };
}

const lines = readFileSync(0, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
let checked = 0;
const missing = [];
for (const dir of lines) {
  const p = parseDir(dir);
  if (p === null) continue;
  checked++;
  if (p.bad || !locked.has(p.key)) missing.push(p.bad ?? p.key);
}
for (const m of missing) console.error(`not in lockfile: ${m}`);
console.log(`${checked} packages, ${missing.length} not in lockfile`);
process.exit(checked === 0 || missing.length > 0 ? 1 : 0);
