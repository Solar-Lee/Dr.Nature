#!/usr/bin/env node
// Every environment variable name the project uses must come from the whitelist in docs/ENV.md
// (CLAUDE.md §2). Checked here:
//  - committed .env.example files: every `NAME=` line;
//  - host scripts and launchd templates under infra/host/**: every DRN_* and DOCKER_* token
//    (the host-side names; P12-16);
//  - compose files infra/*.yml (production file and overrides): upper-case `environment:` keys
//    and every ${VAR} / $${VAR} reference (P12-02).
// `--root <dir>` points the check at another tree (used by the tests with fixtures).
import { readFileSync, globSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootArg = process.argv.indexOf("--root");
const root = rootArg >= 0 ? process.argv[rootArg + 1] : join(dirname(fileURLToPath(import.meta.url)), "..");
if (!root) {
  console.error("check-env-names: --root needs a directory");
  process.exit(2);
}
process.chdir(root);

const whitelist = new Set(
  [...readFileSync("docs/ENV.md", "utf8").matchAll(/^\| `([A-Z0-9_]+)`/gm)].map((m) => m[1]),
);
if (whitelist.size === 0) {
  console.error("check-env-names: no names parsed from docs/ENV.md");
  process.exit(1);
}

let bad = 0;
let files = 0;
const report = (file, name) => {
  console.error(`error ${file}: ${name} is not in docs/ENV.md`);
  bad++;
};
const checkNames = (file, names) => {
  files++;
  for (const name of new Set(names)) {
    if (!whitelist.has(name)) report(file, name);
  }
};

for (const f of globSync("{.env.example,apps/*/.env.example}")) {
  checkNames(f, [...readFileSync(f, "utf8").matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
}

// Host scripts: names the project itself defines (DRN_*) or passes to the Docker CLI (DOCKER_*).
for (const f of globSync("infra/host/**/*")) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue; // directories
  }
  checkNames(f, [...text.matchAll(/\b((?:DRN|DOCKER)_[A-Z0-9_]+)\b/g)].map((m) => m[1]));
}

// Compose files: environment keys and variable references (both host-side ${VAR} and the
// container-side $${VAR} that compose passes through).
for (const f of globSync("infra/*.yml")) {
  const text = readFileSync(f, "utf8");
  const names = [];
  for (const m of text.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s/gm)) names.push(m[1]);
  for (const m of text.matchAll(/\$\$?\{([A-Z][A-Z0-9_]*)[:?}]/g)) names.push(m[1]);
  checkNames(f, names);
}

console.log(`check-env-names: ${files} file(s), ${whitelist.size} whitelisted names, ${bad} error(s)`);
process.exit(bad ? 1 : 0);
