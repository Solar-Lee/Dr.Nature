import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../check-image-deps.mjs", import.meta.url));
const LOCK = `lockfileVersion: '9.0'

importers:

  .: {}

packages:

  '@types/babel__core@7.20.5':
    resolution: {integrity: sha512-x}

  string_decoder@1.3.0:
    resolution: {integrity: sha512-y}

  '@medusajs/medusa@2.21.2':
    resolution: {integrity: sha512-z}

snapshots:

  '@medusajs/medusa@9.9.9(react@18.3.1)':
    dependencies: {}

  left-pad@1.0.0:
    dependencies: {}
`;
const lockfile = join(mkdtempSync(join(tmpdir(), "drn-imgdeps-")), "pnpm-lock.yaml");
writeFileSync(lockfile, LOCK);
const run = (input) => spawnSync(process.execPath, [script, "--lockfile", lockfile], { input, encoding: "utf8" });

test("every image directory is a locked name@version -> exit 0", () => {
  const r = run("@types+babel__core@7.20.5\nstring_decoder@1.3.0\n@medusajs+medusa@2.21.2_ogozqiuipgz3p6w2d5ezd5iqua\n");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^3 packages, 0 not in lockfile$/m);
});

test("lock.yaml and node_modules entries are skipped", () => {
  const r = run("lock.yaml\nnode_modules\nstring_decoder@1.3.0\n");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^1 packages, 0 not in lockfile$/m);
});

test("a version that is not in packages: -> exit 1 (snapshots: keys do not count)", () => {
  const r = run("string_decoder@1.3.0\n@medusajs+medusa@9.9.9_react@18.3.1\n");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^2 packages, 1 not in lockfile$/m);
  assert.match(r.stderr, /not in lockfile: @medusajs\/medusa@9\.9\.9/);
});

test("a key that exists only under snapshots: is not locked -> exit 1", () => {
  const r = run("left-pad@1.0.0\n");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not in lockfile: left-pad@1\.0\.0/);
});

test("empty input -> exit 1", () => {
  assert.equal(run("").status, 1);
  assert.equal(run("lock.yaml\nnode_modules\n").status, 1);
});
