// drn-gen-env.sh / drn-env-check.sh (P12-17) run against a temporary HOME; nothing touches ~/drn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const GEN = here("../../infra/host/drn-gen-env.sh");
const CHECK = here("../../infra/host/drn-env-check.sh");
const ENV_MD = readFileSync(here("../../docs/ENV.md"), "utf8");
const whitelist = new Set([...ENV_MD.matchAll(/^\| `([A-Z0-9_]+)`/gm)].map((m) => m[1]));

const run = (script, args, home) => spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env, HOME: home } });
const parse = (text) => Object.fromEntries([...text.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => [m[1], m[2]]));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

test("generates ~/drn/.env with mode 600, prints names only, refuses to overwrite", () => {
  const home = mkdtempSync(join(tmpdir(), "drn-genenv-"));
  const r = run(GEN, ["drn-api.example.tw"], home);
  assert.equal(r.status, 0, r.stderr);
  const file = join(home, "drn/.env");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(home, "drn")).mode & 0o777, 0o700);
  const vars = parse(readFileSync(file, "utf8"));
  // Output never contains a secret value.
  for (const k of ["POSTGRES_PASSWORD", "JWT_SECRET", "COOKIE_SECRET"]) {
    assert.match(vars[k], /^[0-9a-f]{64}$/, k);
    assert.ok(!r.stdout.includes(vars[k]), `${k} leaked to stdout`);
  }
  assert.match(r.stdout, /^-rw-------@? /m); // macOS appends @ for xattrs
  assert.match(r.stdout, /^POSTGRES_PASSWORD$/m);
  // Every name is whitelisted; DATABASE_URL binds drn-postgres with the generated password.
  for (const k of Object.keys(vars)) assert.ok(whitelist.has(k), `${k} not in docs/ENV.md`);
  assert.equal(vars.DATABASE_URL, `postgres://drn:${vars.POSTGRES_PASSWORD}@drn-postgres:5432/drn?sslmode=disable`);
  assert.equal(vars.MEDUSA_BACKEND_URL, "https://drn-api.example.tw");
  assert.equal(vars.ADMIN_CORS, "https://drn-api.example.tw");
  assert.equal(vars.AUTH_CORS, "https://dr.nature.smilelife.tw,https://drn-api.example.tw");
  assert.equal(vars.ECPAY_ENV, "stage");
  assert.equal(vars.ECPAY_MERCHANT_ID, "3002607");
  assert.equal(vars.MEDUSA_DISABLE_TELEMETRY, "true");
  for (const k of ["EMAIL_PROVIDER", "ECPAY_API_BASE_URL", "ECPAY_LOGISTICS_API_BASE_URL", "ECPAY_INVOICE_API_BASE_URL", "ECPAY_ACCEPT_SIMULATED_PAYMENTS", "ECPAY_INVOICE_MERCHANT_ID", "TZ"]) {
    assert.equal(vars[k], undefined, `${k} must not be written`);
  }
  // Second run: refused, file unchanged.
  const before = sha(file);
  const again = run(GEN, ["drn-api.example.tw"], home);
  assert.notEqual(again.status, 0);
  assert.equal(sha(file), before);
  // The generated file passes drn-env-check.
  const c = run(CHECK, [], home);
  assert.equal(c.status, 0, c.stdout + c.stderr);
  assert.match(c.stdout, /^missing=0 forbidden=0$/m);
});

test("localhost or a bare word is not a public host name", () => {
  for (const bad of ["localhost", "localhost:9000", "drn-api", "127.0.0.1", "mini.local"]) {
    const home = mkdtempSync(join(tmpdir(), "drn-genenv-"));
    const r = run(GEN, [bad], home);
    assert.notEqual(r.status, 0, bad);
  }
  const none = run(GEN, [], mkdtempSync(join(tmpdir(), "drn-genenv-")));
  assert.notEqual(none.status, 0);
});

test("drn-env-check reports missing names and forbidden names without printing values", () => {
  const home = mkdtempSync(join(tmpdir(), "drn-genenv-"));
  mkdirSync(join(home, "drn"));
  const file = join(home, "drn/.env");
  const good = run(GEN, ["drn-api.example.tw"], home);
  assert.equal(good.status, 0);
  let text = readFileSync(file, "utf8").replace(/^JWT_SECRET=.*$/m, "") + "EMAIL_PROVIDER=log\nECPAY_ACCEPT_SIMULATED_PAYMENTS=true\n";
  writeFileSync(file, text);
  chmodSync(file, 0o600);
  const r = run(CHECK, [], home);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^missing=1 forbidden=2$/m);
  assert.match(r.stdout, /^missing JWT_SECRET$/m);
  assert.match(r.stdout, /^forbidden EMAIL_PROVIDER$/m);
  const vars = parse(readFileSync(file, "utf8"));
  assert.ok(!r.stdout.includes(vars.POSTGRES_PASSWORD));
  // Wrong mode is a failure even when complete.
  const home2 = mkdtempSync(join(tmpdir(), "drn-genenv-"));
  run(GEN, ["drn-api.example.tw"], home2);
  chmodSync(join(home2, "drn/.env"), 0o644);
  const m = run(CHECK, [], home2);
  assert.equal(m.status, 1);
  assert.match(m.stdout, /mode 644/);
});

test("--host checks DRN_API_HOST and the five Healthchecks URLs in host.env", () => {
  const home = mkdtempSync(join(tmpdir(), "drn-genenv-"));
  mkdirSync(join(home, "drn"));
  const file = join(home, "drn/host.env");
  writeFileSync(file, "DRN_API_HOST=\nDRN_HC_HEARTBEAT_URL=\nDRN_HC_ALERT_URL=\nDRN_HC_ACCESS_URL=\nDRN_HC_BACKUP_URL=\nDRN_HC_DRILL_URL=\nDRN_R2_REMOTE=\n");
  chmodSync(file, 0o600);
  const empty = run(CHECK, ["--host"], home);
  assert.equal(empty.status, 1);
  assert.match(empty.stdout, /^missing=6 forbidden=0$/m);
  writeFileSync(file, "DRN_API_HOST=drn-api.example.tw\n" + ["HEARTBEAT", "ALERT", "ACCESS", "BACKUP", "DRILL"].map((n) => `DRN_HC_${n}_URL=https://hc-ping.example/${n}`).join("\n") + "\n");
  chmodSync(file, 0o600);
  const full = run(CHECK, ["--host"], home);
  assert.equal(full.status, 0, full.stdout);
  assert.match(full.stdout, /^missing=0 forbidden=0$/m);
  assert.ok(!full.stdout.includes("hc-ping.example"), "URL value leaked");
});
