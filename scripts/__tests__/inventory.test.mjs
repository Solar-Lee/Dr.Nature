import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../infra/host/drn-inventory.sh", import.meta.url));
const BASE = `## docker
open-webui ghcr.io/open-webui/open-webui:main
## volumes
open-webui
## networks
bridge
## images
ghcr.io/open-webui/open-webui:main
postgres:16-alpine
## listen
com.docke 3000
postgres 5432
## launchagents
homebrew.mxcl.postgresql@16.plist
## disk
180
`;
const dir = mkdtempSync(join(tmpdir(), "drn-inv-"));
const file = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
const compare = (a, b) => spawnSync("bash", [SCRIPT, "compare", a, b], { encoding: "utf8" });

test("identical snapshots -> unexpected=0, exit 0", () => {
  const r = compare(file("a", BASE), file("b", BASE));
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^unexpected=0$/m);
});

test("drn additions are allowed: containers, volumes, networks, images, port 3961, drn.*.plist", () => {
  const after = `## docker
drn-backend drn-backend:current
drn-postgres postgres:16-alpine
open-webui ghcr.io/open-webui/open-webui:main
## volumes
drn_pgdata
open-webui
## networks
bridge
drn_edge
drn_net
## images
drn-backend:current
ghcr.io/open-webui/open-webui:main
postgres:16-alpine
redis:7-alpine
## listen
com.docke 3000
com.docke 3961
postgres 5432
## launchagents
drn.backup.plist
drn.compose-up.plist
homebrew.mxcl.postgresql@16.plist
## disk
170
`;
  const r = compare(file("a2", BASE), file("b2", after));
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^unexpected=0$/m);
  assert.match(r.stdout, /allowed addition \(docker\): drn-backend/);
});

test("a removed non-drn launch agent -> unexpected", () => {
  const r = compare(file("a3", BASE), file("b3", BASE.replace("homebrew.mxcl.postgresql@16.plist\n", "")));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /removed \(launchagents\): homebrew.mxcl.postgresql@16.plist/);
  assert.match(r.stdout, /^unexpected=1$/m);
});

test("a changed listener on 5432 -> unexpected; an extra non-drn container -> unexpected", () => {
  const r = compare(file("a4", BASE), file("b4", BASE.replace("postgres 5432\n", "com.docke 5432\n")));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /removed \(listen\): postgres 5432/);
  assert.match(r.stdout, /added \(listen\): com.docke 5432/);
  const c = compare(file("a5", BASE), file("b5", BASE.replace("## volumes", "qdrant qdrant/qdrant:latest\n## volumes")));
  assert.equal(c.status, 1);
  assert.match(c.stdout, /added \(docker\): qdrant qdrant\/qdrant:latest/);
});

test("docker not running on one side is unverifiable, not a failure; low disk after is a failure", () => {
  const down = BASE.replace(/## docker\n[\s\S]*?## listen/, "## docker\nnot-running\n## volumes\nnot-running\n## networks\nnot-running\n## images\nnot-running\n## listen");
  const r = compare(file("a6", BASE), file("b6", down));
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /unverifiable: docker/);
  const low = compare(file("a7", BASE), file("b7", BASE.replace("## disk\n180\n", "## disk\n12\n")));
  assert.equal(low.status, 1);
  assert.match(low.stdout, /disk: only 12 GB free/);
});

test("snapshot writes the seven sections", () => {
  const out = join(dir, "snap.txt");
  const r = spawnSync("bash", [SCRIPT, "snapshot", out], { encoding: "utf8", env: { ...process.env, HOME: dir } });
  assert.equal(r.status, 0, r.stderr);
  const text = spawnSync("cat", [out], { encoding: "utf8" }).stdout;
  assert.equal((text.match(/^## /gm) || []).length, 7);
  assert.doesNotMatch(text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/); // no addresses, no PIDs
});
