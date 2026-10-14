// drn-monitor.sh (P12-20) in a throwaway HOME: fake drn-docker (fixtures/fake-drn-docker.sh) and
// a fake curl on PATH; host.env has no ping URLs, so every Healthchecks call is only printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = fileURLToPath(new URL("../../infra/host", import.meta.url));
const FAKE_DOCKER = fileURLToPath(new URL("./fixtures/fake-drn-docker.sh", import.meta.url));
const FAKE_CURL = fileURLToPath(new URL("./fixtures/fake-curl.sh", import.meta.url));
const bash = (args, opts = {}) => spawnSync("bash", args, { encoding: "utf8", ...opts });
const iso = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000).toISOString().replace(/\.\d{3}Z$/, ".000000000Z");

function ctx() {
  const home = mkdtempSync(join(tmpdir(), "drn-mon-"));
  const r = bash([join(HOST, "install.sh")], { env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  copyFileSync(FAKE_DOCKER, join(home, "drn/bin/drn-docker"));
  chmodSync(join(home, "drn/bin/drn-docker"), 0o700);
  const fake = join(home, "fake");
  mkdirSync(join(fake, "bin"), { recursive: true });
  copyFileSync(FAKE_CURL, join(fake, "bin/curl"));
  chmodSync(join(fake, "bin/curl"), 0o700);
  writeFileSync(join(fake, "started-drn-worker"), iso(5 * 60) + "\n");
  writeFileSync(join(fake, "logs-drn-worker"), "");
  const env = { ...process.env, HOME: home, FAKE: fake, PATH: `${join(fake, "bin")}:${process.env.PATH}` };
  return { home, fake, env };
}
const run = (c, args = []) => bash([join(c.home, "drn/bin/drn-monitor.sh"), ...args], { env: c.env });
const calls = (c) => (existsSync(join(c.fake, "calls.log")) ? readFileSync(join(c.fake, "calls.log"), "utf8") : "");

test("all green: heartbeat ok, alert ok, access skipped without DRN_API_HOST", () => {
  const c = ctx();
  const r = run(c);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /^hc heartbeat ok ok$/m);
  assert.match(r.stdout, /^hc alert ok /m);
  assert.match(r.stdout, /access: DRN_API_HOST unset, skipped/);
  assert.doesNotMatch(calls(c), /compose/);
});

test("jobs: a worker started 5 minutes ago without a heartbeat line is not a failure; 30 minutes ago it is", () => {
  const c = ctx();
  assert.match(run(c).stdout, /^hc heartbeat ok ok$/m);
  writeFileSync(join(c.fake, "started-drn-worker"), iso(30 * 60) + "\n");
  assert.match(run(c).stdout, /^hc heartbeat fail .*\bjobs\b/m);
  writeFileSync(join(c.fake, "logs-drn-worker"), '{"level":"info","message":"[JOB-HEARTBEAT] scheduler alive"}\n');
  assert.match(run(c).stdout, /^hc heartbeat ok ok$/m);
});

test("simpay: flag on without the marker -> simpay-unexpected; with a fresh marker it is fine; stale marker fails", () => {
  const c = ctx();
  writeFileSync(join(c.fake, "exec-exit"), "10");
  assert.match(run(c).stdout, /^hc heartbeat fail .*simpay-unexpected/m);
  writeFileSync(join(c.home, "drn/run/simpay-on"), String(Math.floor(Date.now() / 1000)));
  assert.match(run(c).stdout, /^hc heartbeat ok ok$/m);
  writeFileSync(join(c.home, "drn/run/simpay-on"), String(Math.floor(Date.now() / 1000) - 5 * 3600));
  assert.match(run(c).stdout, /simpay-too-long/);
});

test("alerts stay failed until acked, even when no new line arrives", () => {
  const c = ctx();
  writeFileSync(join(c.fake, "logs-drn-backend"), "2026-10-14T00:00:01Z [ECPAY-ALERT] x\n");
  assert.match(run(c).stdout, /^hc alert fail ALERT x1 ERRORS x\d+$/m);
  writeFileSync(join(c.fake, "logs-drn-backend"), "");
  assert.match(run(c).stdout, /^hc alert fail ALERT x1/m);
  bash([join(c.home, "drn/bin/drn-maint"), "ack", "alerts"], { env: c.env });
  assert.match(run(c).stdout, /^hc alert ok /m);
});

test("access: 200 instead of the recorded 302 baseline is a drift; the next run within an hour sends no access ping", () => {
  const c = ctx();
  writeFileSync(join(c.home, "drn/host.env"), "DRN_API_HOST=drn-api.example.tw\n");
  const rec = run(c, ["--record-access-baseline"]);
  assert.match(rec.stdout, /access baseline recorded: status=302 location=drn.cloudflareaccess.com mitigated=0/);
  assert.equal(readFileSync(join(c.home, "drn/state/access-baseline"), "utf8").trim(), "status=302 location=drn.cloudflareaccess.com mitigated=0");
  writeFileSync(join(c.fake, "access-headers"), "HTTP/2 200\r\ncontent-type: application/json\r\n");
  const first = run(c);
  assert.match(first.stdout, /^hc access fail access-drift:200$/m);
  const second = run(c);
  assert.doesNotMatch(second.stdout, /^hc access/m);
  const forced = run(c, ["--access-only", "--access-path", "/health"]);
  assert.match(forced.stdout, /^hc access fail access-drift:200$/m);
  writeFileSync(join(c.fake, "access-headers"), "HTTP/2 302\r\nlocation: https://drn.cloudflareaccess.com/x\r\ncf-mitigated: challenge\r\n");
  assert.match(run(c, ["--access-only"]).stdout, /^hc access fail access-drift:302$/m);
});

test("maintenance: fresh flag -> heartbeat ok with the reason and no container checks; expired flag -> maintenance-overdue", () => {
  const c = ctx();
  bash([join(c.home, "drn/bin/drn-maint"), "quiet", "deploy", "30"], { env: c.env });
  writeFileSync(join(c.fake, "running-drn-worker"), "false\n");
  const r = run(c);
  assert.match(r.stdout, /^hc heartbeat fail containers:drn-worker$/m);
  assert.doesNotMatch(calls(c), /compose/); // no auto-up during maintenance
  assert.doesNotMatch(readFileSync(join(c.home, "drn/logs/monitor.log"), "utf8"), /auto-up/);
  assert.ok(!existsSync(join(c.home, "drn/state/monitor/last-auto-up")));
  writeFileSync(join(c.fake, "running-drn-worker"), "true\n");
  assert.match(run(c).stdout, /^hc heartbeat ok maintenance deploy$/m);
  writeFileSync(join(c.home, "drn/run/maintenance"), `old|${Math.floor(Date.now() / 1000) - 10}\n`);
  assert.match(run(c).stdout, /maintenance-overdue:old/);
});

test("auto-up (D25): a stopped core container triggers drn-compose-up once, then not again within 30 minutes", () => {
  const c = ctx();
  writeFileSync(join(c.fake, "running-drn-backend"), "false\n");
  const r = run(c);
  assert.match(r.stdout, /^hc heartbeat fail containers:drn-backend/m);
  const n = (calls(c).match(/compose -p drn .* up -d --wait/g) || []).length;
  assert.equal(n, 1, calls(c));
  assert.ok(existsSync(join(c.home, "drn/state/monitor/last-auto-up")));
  run(c);
  assert.equal((calls(c).match(/compose -p drn .* up -d --wait/g) || []).length, 1);
  assert.match(readFileSync(join(c.home, "drn/logs/monitor.log"), "utf8"), /auto-up/);
});

test("restart count increase and OOM kill stick for 60 minutes; redis AOF status and backup age are checked", () => {
  const c = ctx();
  run(c);
  writeFileSync(join(c.fake, "restarts-drn-postgres"), "3 false\n");
  assert.match(run(c).stdout, /restarts:drn-postgres/);
  writeFileSync(join(c.fake, "restarts-drn-postgres"), "3 false\n");
  assert.match(run(c).stdout, /restarts:drn-postgres/); // sticky although the count did not grow again
  writeFileSync(join(c.fake, "redis-info"), "aof_last_write_status:err\n");
  assert.match(run(c).stdout, /redis-aof/);
  writeFileSync(join(c.fake, "redis-info"), "aof_last_write_status:ok\n");
  writeFileSync(join(c.home, "drn/state/backup-enabled"), "");
  assert.match(run(c).stdout, /backup-age:none/);
  mkdirSync(join(c.home, "drn/backups/daily"), { recursive: true });
  const m = join(c.home, "drn/backups/daily/drn-20261010T041500Z.manifest");
  writeFileSync(m, "toc=1\n");
  const old = new Date(Date.now() - 30 * 3600 * 1000);
  utimesSync(m, old, old);
  assert.match(run(c).stdout, /backup-age:30h/);
});
