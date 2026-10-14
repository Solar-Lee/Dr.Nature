// Host package (infra/host, P12-18): syntax, forbidden commands, launchd templates, the installer
// in a throwaway HOME, and the scripts' decisions against a fake drn-docker. Nothing here touches
// the real ~/drn, Docker or launchd.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = fileURLToPath(new URL("../../infra/host", import.meta.url));
const FAKE_DOCKER = fileURLToPath(new URL("./fixtures/fake-drn-docker.sh", import.meta.url));
const FAKE_CURL = fileURLToPath(new URL("./fixtures/fake-curl.sh", import.meta.url));
const scripts = readdirSync(HOST).filter((f) => /^(drn-|agents\.sh$|install\.sh$)/.test(f) && !/\.(mjs|json)$/.test(f) && statSync(join(HOST, f)).isFile());
const plists = readdirSync(join(HOST, "launchd")).filter((f) => f.endsWith(".plist"));
const bash = (args, opts = {}) => spawnSync("bash", args, { encoding: "utf8", ...opts });
const stripComments = (text) => text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("every host script passes bash -n", () => {
  assert.ok(scripts.length >= 13, scripts.join(","));
  for (const f of scripts) {
    const r = bash(["-n", join(HOST, f)]);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test("forbidden commands never appear (prune, sudo, down -v, colima, volume rm, printenv, inspect without -f, compose config without -q)", () => {
  const rules = [
    [/\bprune\b/, "prune"],
    [/\bsudo\b/, "sudo"],
    [/\bdown -v\b/, "down -v"],
    [/colima/i, "colima"],
    [/\bvolume rm\b/, "volume rm"],
    [/\bprintenv\b/, "printenv"],
    [/\binspect\b(?! -f )/, "inspect without -f"],
    [/\$\{?DATABASE_URL|cat .*\.env\b/, "reading .env values"],
  ];
  for (const f of scripts) {
    const body = stripComments(readFileSync(join(HOST, f), "utf8"));
    for (const [re, name] of rules) assert.doesNotMatch(body, re, `${f}: ${name}`);
    for (const line of body.split("\n")) {
      if (/compose/.test(line) && /\bconfig\b/.test(line)) assert.match(line, /\bconfig -q\b/, `${f}: compose config without -q`);
    }
  }
});

test("launchd templates: drn.* label, drn header comment, scripts under __HOME__/drn/bin, DOCKER_HOST + DOCKER_CONFIG, no Desktop path, valid plist", () => {
  assert.ok(plists.includes("drn.compose-up.plist"));
  for (const p of plists) {
    const text = readFileSync(join(HOST, "launchd", p), "utf8");
    assert.match(text, /<!-- # drn-/);
    assert.match(text, new RegExp(`<key>Label</key><string>${p.replace(".plist", "").replace(".", "\\.")}</string>`));
    assert.match(text, /<string>__HOME__\/drn\/bin\/[a-z.-]+<\/string>/);
    assert.match(text, /<key>DOCKER_HOST<\/key><string>unix:\/\/__HOME__\/\.docker\/run\/docker\.sock<\/string>/);
    assert.match(text, /<key>DOCKER_CONFIG<\/key><string>__HOME__\/drn\/docker-config<\/string>/);
    assert.doesNotMatch(text, /Desktop/);
    assert.doesNotMatch(text, /KeepAlive/);
    if (process.platform === "darwin") {
      const tmp = join(mkdtempSync(join(tmpdir(), "drn-plist-")), p);
      writeFileSync(tmp, text.replaceAll("__HOME__", "/Users/x"));
      const r = spawnSync("plutil", ["-lint", tmp], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stdout + r.stderr);
    }
  }
});

test("drn-docker: absolute Docker.app binary, own DOCKER_CONFIG, DOCKER_CONTEXT unset; without the socket it exits 2", () => {
  const text = readFileSync(join(HOST, "drn-docker"), "utf8");
  assert.match(text, /\/Applications\/Docker\.app\/Contents\/Resources\/bin\/docker/);
  assert.match(text, /export DOCKER_CONFIG="\$HOME\/drn\/docker-config"/);
  assert.match(text, /unset DOCKER_CONTEXT/);
  assert.match(text, /export DOCKER_HOST="unix:\/\/\$sock"/);
  const home = mkdtempSync(join(tmpdir(), "drn-docker-"));
  const r = bash([join(HOST, "drn-docker"), "info"], { env: { ...process.env, HOME: home } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /socket/);
  const cfg = JSON.parse(readFileSync(join(HOST, "docker-config.json"), "utf8"));
  assert.deepEqual(Object.keys(cfg), ["cliPluginsExtraDirs"]);
  assert.deepEqual(cfg.cliPluginsExtraDirs, ["/Applications/Docker.app/Contents/Resources/cli-plugins"]);
});

// ---- installer and scripts in a throwaway HOME with a fake drn-docker ---------------------
function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "drn-home-"));
  const r = bash([join(HOST, "install.sh")], { env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const fake = join(home, "fake");
  mkdirSync(fake);
  copyFileSync(FAKE_DOCKER, join(home, "drn/bin/drn-docker"));
  chmodSync(join(home, "drn/bin/drn-docker"), 0o700);
  // Fake curl first on PATH: the real host may run the production backend on 127.0.0.1:3961.
  mkdirSync(join(fake, "bin"));
  copyFileSync(FAKE_CURL, join(fake, "bin/curl"));
  chmodSync(join(fake, "bin/curl"), 0o700);
  return { home, fake, env: { ...process.env, HOME: home, FAKE: fake, PATH: `${join(fake, "bin")}:${process.env.PATH}` } };
}
const runIn = (ctx, script, args = []) => bash([join(ctx.home, "drn/bin", script), ...args], { env: ctx.env });

test("install.sh is idempotent: 700/600 modes, no .env ever, templates kept, plist rendered", () => {
  const home = mkdtempSync(join(tmpdir(), "drn-home-"));
  const env = { ...process.env, HOME: home };
  const first = bash([join(HOST, "install.sh")], { env });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(statSync(join(home, "drn")).mode & 0o777, 0o700);
  assert.equal(statSync(join(home, "drn/bin")).mode & 0o777, 0o700);
  assert.ok(!existsSync(join(home, "drn/.env")));
  for (const f of ["tunnel.env", "host.env", "docker-config/config.json", "docker-compose.prod.yml", "drill-simulated-payments.yml"]) {
    assert.equal(statSync(join(home, "drn", f)).mode & 0o777, 0o600, f);
  }
  assert.ok(readdirSync(join(home, "drn/bin")).length >= 13);
  for (const f of readdirSync(join(home, "drn/bin"))) assert.equal(statSync(join(home, "drn/bin", f)).mode & 0o777, 0o700, f);
  const plist = readFileSync(join(home, "Library/LaunchAgents/drn.compose-up.plist"), "utf8");
  assert.doesNotMatch(plist, /__HOME__/);
  assert.match(plist, new RegExp(`${home}/drn/bin/drn-compose-up.sh`));
  // Second run keeps what Aki wrote into the templates and still never creates .env.
  writeFileSync(join(home, "drn/tunnel.env"), "TUNNEL_TOKEN=test-only\n");
  writeFileSync(join(home, "drn/host.env"), "DRN_HC_HEARTBEAT_URL=https://hc.example/x\n");
  const second = bash([join(HOST, "install.sh")], { env });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(join(home, "drn/tunnel.env"), "utf8"), "TUNNEL_TOKEN=test-only\n");
  assert.equal(readFileSync(join(home, "drn/host.env"), "utf8"), "DRN_HC_HEARTBEAT_URL=https://hc.example/x\n");
  assert.ok(!existsSync(join(home, "drn/.env")));
  assert.doesNotMatch(stripComments(readFileSync(join(HOST, "install.sh"), "utf8")), /\$dir\/\.env\b|drn\/\.env\b/);
});

test("drn-compose-up: maintenance flag -> exit 3 and compose-up:maintenance, no compose call", () => {
  const ctx = fakeHome();
  const m = runIn(ctx, "drn-maint", ["quiet", "deploy-test", "30"]);
  assert.equal(m.status, 0, m.stderr);
  const r = runIn(ctx, "drn-compose-up.sh");
  assert.equal(r.status, 3);
  assert.match(r.stdout, /^hc heartbeat fail compose-up:maintenance deploy-test$/m);
  assert.ok(!existsSync(join(ctx.fake, "calls.log")) || !readFileSync(join(ctx.fake, "calls.log"), "utf8").includes("compose"));
});

test("drn-compose-up: compose failure -> exit 5 compose-up:up; up ok but no local /health -> exit 6", () => {
  const ctx = fakeHome();
  writeFileSync(join(ctx.fake, "compose-exit"), "1");
  const r = runIn(ctx, "drn-compose-up.sh");
  assert.equal(r.status, 5);
  assert.match(r.stdout, /compose-up:up/);
  assert.match(readFileSync(join(ctx.fake, "calls.log"), "utf8"), /compose -p drn -f .*docker-compose.prod.yml up -d --wait/);
  writeFileSync(join(ctx.fake, "compose-exit"), "0");
  writeFileSync(join(ctx.fake, "health"), "DOWN");
  const h = runIn(ctx, "drn-compose-up.sh");
  assert.equal(h.status, 6); // fake curl reports 127.0.0.1:3961 unreachable
  assert.match(h.stdout, /compose-up:health/);
});

test("drn-maint: quiet over 120 minutes refused; status; ack resets the pending counter", () => {
  const ctx = fakeHome();
  assert.notEqual(runIn(ctx, "drn-maint", ["quiet", "x", "121"]).status, 0);
  assert.equal(runIn(ctx, "drn-maint", ["quiet", "x", "5"]).status, 0);
  assert.match(runIn(ctx, "drn-maint", ["status"]).stdout, /maintenance: x \(expires \d+\)/);
  writeFileSync(join(ctx.home, "drn/state/monitor/alerts-pending"), "3\n");
  assert.equal(runIn(ctx, "drn-maint", ["ack", "alerts"]).status, 0);
  assert.equal(readFileSync(join(ctx.home, "drn/state/monitor/alerts-pending"), "utf8").trim(), "0");
});

test("drn-maint end: keeps the maintenance flag when up fails, removes it only after a successful up", () => {
  const ctx = fakeHome();
  const flag = join(ctx.home, "drn/run/maintenance");
  assert.equal(runIn(ctx, "drn-maint", ["quiet", "deploy", "30"]).status, 0);
  writeFileSync(join(ctx.fake, "compose-exit"), "1");
  const failed = runIn(ctx, "drn-maint", ["end"]);
  assert.equal(failed.status, 1);
  assert.ok(existsSync(flag), "flag must survive a failed end");
  writeFileSync(join(ctx.fake, "compose-exit"), "0");
  const ok = runIn(ctx, "drn-maint", ["end"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(!existsSync(flag));
  assert.match(readFileSync(join(ctx.fake, "calls.log"), "utf8"), /up -d --wait --wait-timeout 600/);
});

test("drn-check-migrations: 7 finished of 8 expected -> exit 1; equal sets and none unfinished -> exit 0", () => {
  const ctx = fakeHome();
  const names = Array.from({ length: 8 }, (_, i) => `drn-000${i + 1}-x`);
  writeFileSync(join(ctx.fake, "run-out"), names.map((n) => `${n}.js`).join("\n") + "\n");
  writeFileSync(join(ctx.fake, "finished"), names.slice(0, 7).join("\n") + "\n");
  writeFileSync(join(ctx.fake, "unfinished"), "0\n");
  const r = runIn(ctx, "drn-check-migrations.sh");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^unfinished=0 drn=7\/8$/m);
  writeFileSync(join(ctx.fake, "finished"), names.join("\n") + "\n");
  const ok = runIn(ctx, "drn-check-migrations.sh", ["--image", "drn-backend:abc"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^unfinished=0 drn=8\/8$/m);
  writeFileSync(join(ctx.fake, "unfinished"), "1\n");
  assert.equal(runIn(ctx, "drn-check-migrations.sh").status, 1);
});

test("drn-drill simpay status: exec exit 10 -> on, 0 -> off, anything else -> unknown and exit 1", () => {
  const ctx = fakeHome();
  writeFileSync(join(ctx.fake, "exec-exit"), "10");
  let r = runIn(ctx, "drn-drill.sh", ["simpay", "status"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^backend=on worker=on marker=no$/m);
  writeFileSync(join(ctx.fake, "exec-exit"), "0");
  r = runIn(ctx, "drn-drill.sh", ["simpay", "status"]);
  assert.match(r.stdout, /^backend=off worker=off/m);
  writeFileSync(join(ctx.fake, "exec-exit"), "7");
  r = runIn(ctx, "drn-drill.sh", ["simpay", "status"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /unknown/);
});

test("drn-alertscan: cursor mode counts ALERT lines once and keeps them pending until ack; --count-since does not move cursors", () => {
  const ctx = fakeHome();
  writeFileSync(join(ctx.fake, "logs-drn-backend"), [
    '2026-10-14T00:00:01Z {"level":"error","message":"ECPay ReturnURL X: [ECPAY-ALERT] paid notice without a matching ECPay payment session"}',
    '2026-10-14T00:00:02Z {"level":"info","message":"ok"}',
    "2026-10-14T00:00:03Z error: [MEMBERSHIP-ALERT] something",
  ].join("\n") + "\n");
  const r = runIn(ctx, "drn-alertscan.sh");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^alerts=2 errors=2 pending=2$/m);
  const month = new Date().toISOString().slice(0, 7).replace("-", "");
  const log = readFileSync(join(ctx.home, `drn/logs/alerts-${month}.log`), "utf8");
  assert.equal((log.match(/-ALERT\]/g) || []).length, 2);
  assert.ok(existsSync(join(ctx.home, "drn/state/monitor/cursor-drn-backend")));
  // No new lines (fake log cleared): pending stays until ack.
  writeFileSync(join(ctx.fake, "logs-drn-backend"), "");
  assert.match(runIn(ctx, "drn-alertscan.sh").stdout, /^alerts=0 errors=0 pending=2$/m);
  runIn(ctx, "drn-maint", ["ack", "alerts"]);
  assert.match(runIn(ctx, "drn-alertscan.sh").stdout, /pending=0$/m);
  // --count-since reports without touching the cursor.
  writeFileSync(join(ctx.fake, "logs-drn-worker"), "2026-10-14T00:00:03Z [ECPAY-ALERT] x\n");
  const before = readFileSync(join(ctx.home, "drn/state/monitor/cursor-drn-worker"), "utf8");
  const c = runIn(ctx, "drn-alertscan.sh", ["--count-since", "2026-10-14T00:00:00Z"]);
  assert.match(c.stdout, /^alerts=1 errors=0$/m);
  assert.equal(readFileSync(join(ctx.home, "drn/state/monitor/cursor-drn-worker"), "utf8"), before);
  const ex = runIn(ctx, "drn-alertscan.sh", ["--count-since", "2026-10-14T00:00:00Z", "--exclude", "[ECPAY-ALERT] x"]);
  assert.match(ex.stdout, /^alerts=0 errors=0$/m);
});

test("drn-releases: first once, append, last, verify-current compares image ids", () => {
  const ctx = fakeHome();
  assert.equal(runIn(ctx, "drn-releases.sh", ["first", "aaaaaaaaaaaa"]).status, 0);
  assert.notEqual(runIn(ctx, "drn-releases.sh", ["first", "bbbbbbbbbbbb"]).status, 0);
  assert.equal(runIn(ctx, "drn-releases.sh", ["append", "deploy", "aaaaaaaaaaaa", "bbbbbbbbbbbb", "pre.dump", "sha", "fp"]).status, 0);
  assert.match(runIn(ctx, "drn-releases.sh", ["last"]).stdout, /deploy aaaaaaaaaaaa bbbbbbbbbbbb pre\.dump sha fp$/m);
  writeFileSync(join(ctx.fake, "image-drn-backend:current"), "sha256:1\n");
  writeFileSync(join(ctx.fake, "image-drn-backend:bbbbbbbbbbbb"), "sha256:2\n");
  assert.equal(runIn(ctx, "drn-releases.sh", ["verify-current"]).status, 1);
  writeFileSync(join(ctx.fake, "image-drn-backend:bbbbbbbbbbbb"), "sha256:1\n");
  const ok = runIn(ctx, "drn-releases.sh", ["verify-current"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /current=bbbbbbbbbbbb/);
});

test("drn-lock: second acquire fails while the holder (this test process) lives; release frees it", () => {
  const ctx = fakeHome();
  assert.equal(runIn(ctx, "drn-lock.sh", ["acquire", "heavy"]).status, 0);
  assert.equal(runIn(ctx, "drn-lock.sh", ["acquire", "heavy"]).status, 1);
  assert.equal(runIn(ctx, "drn-lock.sh", ["release", "heavy"]).status, 0);
  assert.equal(runIn(ctx, "drn-lock.sh", ["acquire", "heavy"]).status, 0);
  // A lock left by a dead process is cleared.
  writeFileSync(join(ctx.home, "drn/run/heavy.lock/pid"), "999999\n");
  assert.equal(runIn(ctx, "drn-lock.sh", ["acquire", "heavy"]).status, 0);
});

test("drn-probe.sh falls back to the Node digest pinned in infra/backend.Dockerfile and always removes its containers", () => {
  const probe = readFileSync(join(HOST, "drn-probe.sh"), "utf8");
  const dockerfile = readFileSync(join(HOST, "../backend.Dockerfile"), "utf8");
  const pinned = dockerfile.match(/^FROM (node:\S+) AS build$/m)[1];
  assert.ok(probe.includes(`node_image="${pinned}"`), "fallback digest differs from the Dockerfile");
  for (const line of probe.split("\n")) if (/drn_docker" run /.test(line)) assert.match(line, /--rm/, line);
});

test("agents.sh refuses labels that do not start with drn.", () => {
  const r = bash([join(HOST, "agents.sh"), "status", "com.apple.Finder"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refusing non-drn label/);
});
