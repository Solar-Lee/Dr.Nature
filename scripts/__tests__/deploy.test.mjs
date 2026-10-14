// drn-deploy.sh / drn-rollback.sh (P12-11) in a throwaway HOME with the fake drn-docker and fake
// curl: proves the ledger gate, the C11 fingerprint gate, the order of destructive steps and the
// refusals. Cannot prove real migrations or pg_restore (rehearsed on the Mac mini).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = fileURLToPath(new URL("../../infra/host", import.meta.url));
const FAKE_DOCKER = fileURLToPath(new URL("./fixtures/fake-drn-docker.sh", import.meta.url));
const FAKE_CURL = fileURLToPath(new URL("./fixtures/fake-curl.sh", import.meta.url));
const bash = (args, opts = {}) => spawnSync("bash", args, { encoding: "utf8", ...opts });
const OLD = "aaaaaaaaaaaa", NEW = "bbbbbbbbbbbb";

function ctx() {
  const home = mkdtempSync(join(tmpdir(), "drn-dep-"));
  assert.equal(bash([join(HOST, "install.sh")], { env: { ...process.env, HOME: home } }).status, 0);
  copyFileSync(FAKE_DOCKER, join(home, "drn/bin/drn-docker"));
  chmodSync(join(home, "drn/bin/drn-docker"), 0o700);
  const fake = join(home, "fake");
  mkdirSync(join(fake, "bin"), { recursive: true });
  copyFileSync(FAKE_CURL, join(fake, "bin/curl"));
  chmodSync(join(fake, "bin/curl"), 0o700);
  mkdirSync(join(fake, "uploads"));
  writeFileSync(join(fake, "anchors"), "3|120|7|0|1|1|1\n");
  writeFileSync(join(fake, "toc"), "1; a\n2; b\n3; c\n");
  writeFileSync(join(fake, `image-drn-backend:${OLD}`), "sha256:old\n");
  writeFileSync(join(fake, `image-drn-backend:${NEW}`), "sha256:new\n");
  writeFileSync(join(fake, "image-drn-backend:current"), "sha256:old\n");
  writeFileSync(join(fake, "image-of-drn-backend"), "sha256:new\n");
  writeFileSync(join(fake, "image-of-drn-worker"), "sha256:new\n");
  writeFileSync(join(fake, "run-out"), "drn-0001-x.js\n");
  writeFileSync(join(fake, "finished"), "drn-0001-x\n");
  writeFileSync(join(fake, "fingerprint-rows"), "order|1|2026\n");
  writeFileSync(join(home, "drn/state/deploy-min-free-gb"), "0\n");
  writeFileSync(join(home, `drn/state/image-ok-${NEW}`), "");
  const env = { ...process.env, HOME: home, FAKE: fake, PATH: `${join(fake, "bin")}:${process.env.PATH}` };
  assert.equal(bash([join(home, "drn/bin/drn-releases.sh"), "first", OLD], { env }).status, 0);
  return { home, fake, env };
}
const run = (c, script, args) => bash([join(c.home, "drn/bin", script), ...args], { env: c.env });
const calls = (c) => readFileSync(join(c.fake, "calls.log"), "utf8");
const ledger = (c) => readFileSync(join(c.home, "drn/logs/releases.log"), "utf8").trim().split("\n");

test("deploy: full order, ledger entries deploy + deployed, maintenance flag cleared", () => {
  const c = ctx();
  const r = run(c, "drn-deploy.sh", [NEW]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const log = calls(c);
  const idx = (re) => log.search(re);
  assert.ok(idx(/compose .* stop drn-worker/) < idx(/compose .* stop drn-backend/), "worker stops before backend");
  assert.ok(idx(/pg_dump /) < idx(/^tag drn-backend:bbbbbbbbbbbb drn-backend:current/m), "pre dump before retag");
  assert.ok(idx(/^tag /m) < idx(/db:migrate --skip-scripts/), "retag before migrate");
  assert.ok(idx(/db:migrate --skip-scripts/) < idx(/db:migrate:scripts/), "two-step order");
  assert.ok(idx(/db:migrate:scripts/) < idx(/compose .* up -d --wait/), "migrate before up");
  const entries = ledger(c);
  assert.equal(entries.length, 3);
  assert.match(entries[1], /^\S+ deploy aaaaaaaaaaaa bbbbbbbbbbbb drn-\S+\.dump [0-9a-f]{64} [0-9a-f]{12}$/);
  assert.match(entries[2], /^\S+ deployed aaaaaaaaaaaa bbbbbbbbbbbb /);
  assert.ok(!existsSync(join(c.home, "drn/run/maintenance")));
  assert.ok(existsSync(join(c.home, "drn/backups/pre")) && readFileSync(join(c.home, "drn/backups/pre/" + entries[1].split(" ")[4].replace(".dump", ".manifest")), "utf8").includes("label=aaaaaaaaaaaa-bbbbbbbbbbbb"));
});

test("deploy refuses: current image does not match the ledger; missing image-ok; unhealthy container; maintenance flag", () => {
  const c = ctx();
  writeFileSync(join(c.fake, "image-drn-backend:current"), "sha256:other\n");
  let r = run(c, "drn-deploy.sh", [NEW]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not match the release ledger/);
  assert.doesNotMatch(calls(c), /stop drn-worker|tag /);
  writeFileSync(join(c.fake, "image-drn-backend:current"), "sha256:old\n");
  r = run(c, "drn-deploy.sh", ["cccccccccccc"]);
  assert.match(r.stderr, /no image-ok-cccccccccccc/);
  writeFileSync(join(c.fake, "health-drn-postgres"), "unhealthy\n");
  r = run(c, "drn-deploy.sh", [NEW]);
  assert.match(r.stderr, /drn-postgres is not healthy/);
  writeFileSync(join(c.fake, "health-drn-postgres"), "healthy\n");
  bash([join(c.home, "drn/bin/drn-maint"), "quiet", "x", "5"], { env: c.env });
  r = run(c, "drn-deploy.sh", [NEW]);
  assert.match(r.stderr, /maintenance flag present/);
});

test("deploy: a failed migration stops with the maintenance flag kept and a rollback hint", () => {
  const c = ctx();
  writeFileSync(join(c.fake, "finished"), "");
  const r = run(c, "drn-deploy.sh", [NEW]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /migration check failed/);
  assert.match(r.stdout, /drn-rollback.sh aaaaaaaaaaaa --restore .*\.dump/);
  assert.ok(existsSync(join(c.home, "drn/run/maintenance")), "flag kept");
  assert.doesNotMatch(calls(c), /compose .* up -d --wait/);
  assert.equal(ledger(c).length, 2); // no "deployed" entry
});

test("rollback --restore: wrong sha256 -> exit 2; writes after the deploy -> exit 4 without dropdb; correct --accept-loss runs backup, drill, dropdb, restore", () => {
  const c = ctx();
  assert.equal(run(c, "drn-deploy.sh", [NEW]).status, 0);
  writeFileSync(join(c.fake, "image-drn-backend:current"), "sha256:new\n");
  const pre = join(c.home, "drn/backups/pre", ledger(c)[2].split(" ")[4]);
  const other = join(c.home, "elsewhere", ledger(c)[2].split(" ")[4]); // same file name, tampered content
  mkdirSync(join(c.home, "elsewhere"));
  writeFileSync(other, "PGDMP-tampered");
  const bad = run(c, "drn-rollback.sh", [OLD, "--restore", other]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /sha256 of .* does not match the ledger/);
  const renamed = run(c, "drn-rollback.sh", [OLD, "--restore", join(c.home, "tampered.dump")]);
  assert.notEqual(renamed.status, 0);
  // Simulate a write after the deploy: the fingerprint rows change.
  writeFileSync(join(c.fake, "fingerprint-rows"), "order|2|2026-10-15\n");
  const refused = run(c, "drn-rollback.sh", [OLD, "--restore", pre]);
  assert.equal(refused.status, 4);
  assert.match(refused.stderr, /--accept-loss ([0-9a-f]{12})/);
  assert.doesNotMatch(calls(c), /dropdb/);
  const code = refused.stderr.match(/--accept-loss ([0-9a-f]{12})/)[1];
  const wrong = run(c, "drn-rollback.sh", [OLD, "--restore", pre, "--accept-loss", "000000000000"]);
  assert.equal(wrong.status, 4);
  const ok = run(c, "drn-rollback.sh", [OLD, "--restore", pre, "--accept-loss", code]);
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  const log = calls(c);
  const after = log.slice(log.lastIndexOf("pg_dumpall"));
  const i = (re) => after.search(re);
  assert.ok(existsSync(join(c.home, "drn/backups/pre-rollback")), "pre-rollback dump dir");
  assert.ok(i(/run -d --rm --name drn-restore-check/) < i(/dropdb/), "drill before dropdb");
  const live = /pg_restore -U "\$POSTGRES_USER" -d "\$POSTGRES_DB"/; // the drill restores into drn_restore instead
  assert.ok(i(/dropdb/) < i(live), "dropdb before the live restore");
  assert.ok(i(live) < i(/^tag drn-backend:aaaaaaaaaaaa drn-backend:current/m), "restore before retag");
  assert.match(ledger(c).at(-1), /^\S+ rollback-restore bbbbbbbbbbbb aaaaaaaaaaaa /);
  assert.ok(!existsSync(join(c.home, "drn/run/maintenance")));
});

test("rollback without --restore is allowed only while the ledger still ends at 'deploy'", () => {
  const c = ctx();
  assert.equal(run(c, "drn-deploy.sh", [NEW]).status, 0);
  const r = run(c, "drn-rollback.sh", [OLD]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ran migrations, use --restore/);
  // Ledger ending at "deploy" (migration step failed): image-only rollback allowed.
  const c2 = ctx();
  writeFileSync(join(c2.fake, "finished"), "");
  assert.equal(run(c2, "drn-deploy.sh", [NEW]).status, 1);
  writeFileSync(join(c2.fake, "finished"), "drn-0001-x\n");
  const ok = run(c2, "drn-rollback.sh", [OLD]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(calls(c2), /^tag drn-backend:aaaaaaaaaaaa drn-backend:current/m);
  assert.doesNotMatch(calls(c2), /dropdb/);
  assert.match(ledger(c2).at(-1), /^\S+ rollback bbbbbbbbbbbb aaaaaaaaaaaa /);
});
