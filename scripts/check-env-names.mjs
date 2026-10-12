#!/usr/bin/env node
// Fails if any variable name in a committed .env.example is missing from docs/ENV.md.
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const whitelist = new Set(
  [...readFileSync("docs/ENV.md", "utf8").matchAll(/^\| `([A-Z0-9_]+)`/gm)].map((m) => m[1]),
);
if (whitelist.size === 0) {
  console.error("check-env-names: no names parsed from docs/ENV.md");
  process.exit(1);
}
const files = globSync("{.env.example,apps/*/.env.example}");
let bad = 0;
for (const f of files) {
  for (const m of readFileSync(f, "utf8").matchAll(/^([A-Z0-9_]+)=/gm)) {
    if (!whitelist.has(m[1])) {
      console.error(`error ${f}: ${m[1]} is not in docs/ENV.md`);
      bad++;
    }
  }
}
console.log(`check-env-names: ${files.length} file(s), ${whitelist.size} whitelisted names, ${bad} error(s)`);
process.exit(bad ? 1 : 0);
