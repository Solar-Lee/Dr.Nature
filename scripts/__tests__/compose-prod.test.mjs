// Text-level invariants of the production compose files (no Docker needed): the rules from
// CLAUDE.md §1 (drn prefix, nothing published but 127.0.0.1:3961) and deployment review
// P12-02 (pinned images, named volumes, AOF, health checks with -U/-d, oom_score_adj, the edge
// profile, the drill override touching one variable only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Full-line comments are dropped so the assertions see configuration, not prose.
const read = (p) =>
  readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
const compose = read("../../infra/docker-compose.prod.yml");
const override = read("../../infra/drill-simulated-payments.yml");

// Crude but sufficient service splitter: top-level `services:` block, 2-space-indented names.
function services(text) {
  const out = {};
  const m = (text + "\n_end_:\n").match(/^services:\n([\s\S]*?)(?=^\S)/m);
  assert.ok(m, "services block");
  let name = null;
  for (const line of m[1].split("\n")) {
    const s = line.match(/^  ([a-z0-9-]+):\s*$/);
    if (s) { name = s[1]; out[name] = ""; continue; }
    if (name) out[name] += line + "\n";
  }
  return out;
}
const svc = services(compose);

test("the only published port is 127.0.0.1:3961 -> 9000 (backend)", () => {
  const ports = [...compose.matchAll(/^\s+- "([^"]+)"\s*$/gm)].map((m) => m[1]).filter((p) => /:\d+$/.test(p) && /^\d|^127/.test(p));
  assert.deepEqual(ports, ["127.0.0.1:3961:9000"]);
  assert.doesNotMatch(svc["drn-postgres"], /ports:/);
  assert.doesNotMatch(svc["drn-redis"], /ports:/);
  assert.doesNotMatch(svc["drn-cloudflared"], /ports:/);
});

test("every image except drn-backend is pinned by sha256 digest; backend is :current with pull_policy never", () => {
  const images = [...compose.matchAll(/^\s+image: (\S+)/gm)].map((m) => m[1]);
  assert.ok(images.length >= 4, images);
  for (const img of images) {
    if (img.startsWith("drn-backend:")) assert.equal(img, "drn-backend:current");
    else assert.match(img, /@sha256:[0-9a-f]{64}$/, img);
  }
  assert.match(compose, /pull_policy: never/);
});

test("volumes and networks carry explicit drn_ names; container names start with drn-", () => {
  const vols = compose.match(/^volumes:\n([\s\S]*?)(?=^\S|\Z)/m)[1];
  for (const v of ["drn_pgdata", "drn_redisdata", "drn_uploads"]) assert.match(vols, new RegExp(`  ${v}:\\n    name: ${v}\\n`));
  const nets = compose.match(/^networks:\n([\s\S]*)$/m)[1];
  for (const n of ["drn_net", "drn_edge"]) assert.match(nets, new RegExp(`  ${n}:\\n    name: ${n}\\n`));
  for (const m of compose.matchAll(/container_name: (\S+)/g)) assert.match(m[1], /^drn-/);
  assert.equal([...compose.matchAll(/container_name:/g)].length, 5);
});

test("no TZ, Supabase or DRN_TAG left over from the VPS version", () => {
  assert.doesNotMatch(compose, /\bTZ\b|supabase|DRN_TAG/i);
});

test("redis: AOF on, noeviction, data volume", () => {
  assert.match(svc["drn-redis"], /"--appendonly", "yes"/);
  assert.match(svc["drn-redis"], /"--appendfsync", "everysec"/);
  assert.match(svc["drn-redis"], /noeviction/);
  assert.match(svc["drn-redis"], /drn_redisdata:\/data/);
});

test("postgres: healthcheck binds -U and -d, 60s stop grace, data volume", () => {
  assert.match(svc["drn-postgres"], /pg_isready -h 127\.0\.0\.1 -U \\"\$\$\{POSTGRES_USER\}\\" -d \\"\$\$\{POSTGRES_DB\}\\"/);
  assert.match(svc["drn-postgres"], /stop_grace_period: 60s/);
  assert.match(svc["drn-postgres"], /drn_pgdata:\/var\/lib\/postgresql\/data/);
  assert.match(svc["drn-postgres"], /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/);
});

test("postgres and redis get oom_score_adj -500; every service has a memory limit", () => {
  assert.match(svc["drn-postgres"], /oom_score_adj: -500/);
  assert.match(svc["drn-redis"], /oom_score_adj: -500/);
  for (const name of Object.keys(svc)) assert.match(svc[name], /mem_limit: \d+m/, name);
});

test("cloudflared: profile edge, only drn_edge, token via env_file, waits for a healthy backend", () => {
  const c = svc["drn-cloudflared"];
  assert.match(c, /profiles: \[edge\]/);
  assert.match(c, /networks: \[drn_edge\]/);
  assert.match(c, /env_file: tunnel\.env/);
  assert.match(c, /command: \["tunnel", "run"\]/);
  assert.match(c, /drn-backend:\n\s+condition: service_healthy/);
  assert.doesNotMatch(c, /TUNNEL_TOKEN=|--token/);
});

test("backend joins drn_net and drn_edge; worker only drn_net (anchor) and has no healthcheck disable", () => {
  assert.match(svc["drn-backend"], /networks: \[drn_net, drn_edge\]/);
  assert.doesNotMatch(svc["drn-worker"], /networks:|disable: true/);
  assert.match(svc["drn-worker"], /MEDUSA_WORKER_MODE: worker/);
  assert.match(svc["drn-worker"], /DISABLE_MEDUSA_ADMIN: "true"/);
  assert.match(svc["drn-backend"], /MEDUSA_WORKER_MODE: server/);
  assert.match(compose, /drn_uploads:\/app\/\.medusa\/server\/static/);
});

test("drill override sets exactly one variable, on backend and worker only", () => {
  const names = [...override.matchAll(/^\s+([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(names)], ["ECPAY_ACCEPT_SIMULATED_PAYMENTS"]);
  assert.equal(names.length, 2);
  const o = services(override);
  assert.deepEqual(Object.keys(o).sort(), ["drn-backend", "drn-worker"]);
  assert.doesNotMatch(override, /image:|ports:|volumes:/);
});
