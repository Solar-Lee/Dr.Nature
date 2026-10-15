// drn-backup.sh / drn-restore-check.sh (P12-08, P12-21) in a throwaway HOME against the fake
// drn-docker. Proves the decisions (files, manifest, retention, offsite rule, anchors, logging);
// cannot prove real pg_dump/pg_restore behaviour, which the rehearsal on the Mac mini covers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = fileURLToPath(new URL("../../infra/host", import.meta.url));
const FAKE_DOCKER = fileURLToPath(new URL("./fixtures/fake-drn-docker.sh", import.meta.url));
const bash = (args, opts = {}) => spawnSync("bash", args, { encoding: "utf8", ...opts });

function ctx() {
  const home = mkdtempSync(join(tmpdir(), "drn-bk-"));
  const r = bash([join(HOST, "install.sh")], { env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  copyFileSync(FAKE_DOCKER, join(home, "drn/bin/drn-docker"));
  chmodSync(join(home, "drn/bin/drn-docker"), 0o700);
  const fake = join(home, "fake");
  mkdirSync(join(fake, "uploads/sub"), { recursive: true });
  writeFileSync(join(fake, "uploads/a.jpg"), "a");
  writeFileSync(join(fake, "uploads/sub/b.jpg"), "b");
  writeFileSync(join(fake, "anchors"), "3|120|8|0|5|2|5\n");
  writeFileSync(join(fake, "toc"), Array.from({ length: 10 }, (_, i) => `${i}; 0 0 TABLE public t${i} drn`).join("\n") + "\n; comment\n");
  return { home, fake, env: { ...process.env, HOME: home, FAKE: fake } };
}
const run = (c, script, args = []) => bash([join(c.home, "drn/bin", script), ...args], { env: c.env });
const files = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);
const manifestOf = (dir) => Object.fromEntries(readFileSync(join(dir, files(dir).find((f) => f.endsWith(".manifest"))), "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

test("daily backup: dump, globals, uploads archive and manifest; Healthchecks start then success", () => {
  const c = ctx();
  const r = run(c, "drn-backup.sh", ["daily"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const daily = join(c.home, "drn/backups/daily");
  const got = files(daily);
  assert.equal(got.length, 4, got.join(","));
  for (const ext of [".dump", ".globals.sql", ".uploads.tar.gz", ".manifest"]) assert.ok(got.some((f) => f.endsWith(ext)), ext);
  const m = manifestOf(daily);
  assert.equal(m.toc, "10");
  assert.equal(m.uploads_files, "2");
  assert.equal(m.anchors_before, "3|120|8|0|5|2|5");
  assert.match(m.dump_sha256, /^[0-9a-f]{64}$/);
  assert.match(r.stdout, /^hc backup start rid=/m);
  assert.match(r.stdout, /^hc backup ok toc=10 sha=[0-9a-f]{12} offsite=unset/m);
  assert.equal(files(join(c.home, "drn/backups/tmp")).length, 0);
  const calls = readFileSync(join(c.fake, "calls.log"), "utf8");
  assert.match(calls, /run --rm --network none -v drn_uploads:\/src:ro --entrypoint tar postgres:16-alpine@sha256:/);
});

test("a missing database container fails with /fail and leaves no backup", () => {
  const c = ctx();
  const r = run(c, "drn-backup.sh", ["daily", "--pg-container", "drn-postgres-nope"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /^hc backup fail line=\d+ exit=\d+ mode=daily$/m);
  assert.equal(files(join(c.home, "drn/backups/daily")).length, 0);
});

test("toc below 90% of the previous backup fails", () => {
  const c = ctx();
  assert.equal(run(c, "drn-backup.sh", ["daily"]).status, 0);
  writeFileSync(join(c.fake, "toc"), "1; 0 0 TABLE public t drn\n");
  const r = run(c, "drn-backup.sh", ["daily"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /hc backup fail/);
});

test("pre backups skip uploads and go to backups/pre; pre needs a label", () => {
  const c = ctx();
  assert.notEqual(run(c, "drn-backup.sh", ["pre"]).status, 0);
  const r = run(c, "drn-backup.sh", ["pre", "aaaa-bbbb"]);
  assert.equal(r.status, 0, r.stderr);
  const pre = join(c.home, "drn/backups/pre");
  assert.equal(files(pre).length, 3);
  assert.equal(manifestOf(pre).uploads_files, "-");
  assert.equal(manifestOf(pre).label, "aaaa-bbbb");
  assert.doesNotMatch(r.stdout, /hc backup/); // only the daily job reports to Healthchecks
});

test("retention keeps the newest 14 daily sets", () => {
  const c = ctx();
  const dir = join(c.home, "ret");
  mkdirSync(dir);
  for (let i = 1; i <= 20; i++) {
    const ts = `drn-202610${String(i).padStart(2, "0")}T041500Z`;
    for (const ext of ["dump", "globals.sql", "manifest"]) writeFileSync(join(dir, `${ts}.${ext}`), "x");
  }
  assert.equal(run(c, "drn-backup.sh", ["--retention-test", dir]).status, 0);
  const left = [...new Set(files(dir).map((f) => f.slice(0, f.indexOf("."))))];
  assert.equal(left.length, 14);
  assert.equal(left[0], "drn-20261007T041500Z");
});

test("offsite-required without a working offsite copy fails", () => {
  const c = ctx();
  writeFileSync(join(c.home, "drn/state/offsite-required"), "");
  const r = run(c, "drn-backup.sh", ["daily"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /hc backup fail/);
});

test("restore drill passes when anchors match and logs one JSON line; Healthchecks gets pass", () => {
  const c = ctx();
  assert.equal(run(c, "drn-backup.sh", ["daily"]).status, 0);
  const r = run(c, "drn-restore-check.sh");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^hc drill ok pass drn-/m);
  const log = readFileSync(join(c.home, "drn/logs/restore-drills.log"), "utf8").trim().split("\n");
  assert.equal(log.length, 1);
  const j = JSON.parse(log[0]);
  assert.equal(j.result, "pass");
  assert.equal(j.anchors_ok, true);
  const calls = readFileSync(join(c.fake, "calls.log"), "utf8");
  assert.match(calls, /run -d --rm --name drn-restore-check --network none --memory 1g .*postgres:16-alpine@sha256:/);
  assert.match(calls, /stop drn-restore-check/);
  assert.ok(!existsSync(join(c.home, "drn/run/heavy.lock")), "lock released");
});

test("restore drill fails on wrong anchors, on a failed pg_restore, and on a broken uploads archive", () => {
  const c = ctx();
  assert.equal(run(c, "drn-backup.sh", ["daily"]).status, 0);
  writeFileSync(join(c.fake, "anchors-drn-restore-check"), "0|120|8|0|5|2|5\n");
  let r = run(c, "drn-restore-check.sh");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^hc drill fail product 0!=3$/m);
  writeFileSync(join(c.fake, "anchors-drn-restore-check"), "3|120|8|0|5|2|5\n");
  writeFileSync(join(c.fake, "restore-exit"), "1");
  r = run(c, "drn-restore-check.sh");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /pg_restore failed/);
  writeFileSync(join(c.fake, "restore-exit"), "0");
  const daily = join(c.home, "drn/backups/daily");
  writeFileSync(join(daily, files(daily).find((f) => f.endsWith(".uploads.tar.gz"))), "not gzip");
  r = run(c, "drn-restore-check.sh");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /uploads archive broken/);
  const results = readFileSync(join(c.home, "drn/logs/restore-drills.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l).result);
  assert.deepEqual(results, ["fail", "fail", "fail"]);
});

test("one-off containers use the same Postgres image digest as drn-postgres in the compose file", () => {
  const lib = readFileSync(join(HOST, "drn-lib.sh"), "utf8");
  const compose = readFileSync(join(HOST, "../docker-compose.prod.yml"), "utf8");
  const libImage = lib.match(/drn_pg_image="([^"]+)"/)[1];
  const composeImage = compose.match(/^\s+image: (postgres:\S+)/m)[1];
  assert.equal(libImage, composeImage);
});
