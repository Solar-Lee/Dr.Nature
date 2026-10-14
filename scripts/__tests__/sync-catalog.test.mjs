// scripts/sync-catalog.mjs: the backend copies (catalog, claims rules) are written and checked.
// [P6-01] The blog publish gate reads apps/backend/src/data/claims.json; a stale copy must fail
// the check, otherwise the backend would enforce older rules than claims-lint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../sync-catalog.mjs", import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "drn-sync-"));
  for (const [path, content] of Object.entries({
    "content/products/catalog.json": '{"products":[]}\n',
    "docs/compliance/claims.json": '{"banned":[{"term":"x"}]}\n',
  })) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
const run = (root, ...args) => spawnSync(process.execPath, [script, "--root", root, ...args], { encoding: "utf8" });

test("write then --check -> both copies identical, exit 0", () => {
  const root = fixture();
  assert.equal(run(root).status, 0);
  assert.equal(readFileSync(join(root, "apps/backend/src/data/catalog.json"), "utf8"), '{"products":[]}\n');
  assert.equal(readFileSync(join(root, "apps/backend/src/data/claims.json"), "utf8"), '{"banned":[{"term":"x"}]}\n');
  const r = run(root, "--check");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 copies up to date/);
});

test("--check: a stale claims copy -> exit 1 naming the file", () => {
  const root = fixture();
  run(root);
  writeFileSync(join(root, "docs/compliance/claims.json"), '{"banned":[{"term":"y"}]}\n');
  const r = run(root, "--check");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /apps\/backend\/src\/data\/claims.json is stale/);
  assert.doesNotMatch(r.stderr, /catalog.json is stale/);
});

test("--check: a missing catalog copy -> exit 1", () => {
  const root = fixture();
  run(root);
  rmSync(join(root, "apps/backend/src/data/catalog.json"));
  const r = run(root, "--check");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /catalog.json is stale/);
});

test("the repository's own copies are up to date", () => {
  const r = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
