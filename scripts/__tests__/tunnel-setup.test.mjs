// drn-tunnel-setup.sh (P12-04) in a throwaway HOME with a fake drn-docker: checks the ingress
// rules it writes for each mode and that a failed `ingress validate` fails the script.
// Cannot prove: how cloudflared matches these regexes (raw vs decoded path, case). That is checked
// on the host with `cloudflared tunnel ingress rule <url>` (docs/ops/edge-cloudflare.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = fileURLToPath(new URL("../../infra/host", import.meta.url));
const ID = "11111111-2222-3333-4444-555555555555";
const bash = (args, opts = {}) => spawnSync("bash", args, { encoding: "utf8", ...opts });

function ctx({ validateFails = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "drn-tun-"));
  const r = bash([join(HOST, "install.sh")], { env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  writeFileSync(join(home, "drn/cloudflared/cert.pem"), "test-only\n");
  writeFileSync(join(home, `drn/cloudflared/${ID}.json`), "{}\n");
  // Fake drn-docker: answers the three cloudflared calls the script makes.
  writeFileSync(join(home, "drn/bin/drn-docker"), `#!/bin/bash
case "$*" in
  *"tunnel list"*) echo '[{"id": "${ID}", "name": "drn-tunnel"}]' ;;
  *"route dns"*) echo "INF already configured" ;;
  *"ingress validate"*) ${validateFails ? 'echo "error: bad rule" >&2; exit 1' : "echo OK"} ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac
`);
  chmodSync(join(home, "drn/bin/drn-docker"), 0o700);
  return { home, env: { ...process.env, HOME: home } };
}
const run = (c, args) => bash([join(c.home, "drn/bin/drn-tunnel-setup.sh"), ...args], { env: c.env });
const rules = (c) => readFileSync(join(c.home, "drn/cloudflared/config.yml"), "utf8").split("ingress:\n")[1];

test("public: only the exact callback paths and /health pass; the rest of the bypassed prefixes get 404; everything else goes behind Access", () => {
  const c = ctx();
  const r = run(c, ["drn-api.example.tw", "public"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mode=public/);
  assert.equal(rules(c), `  - hostname: drn-api.example.tw
    path: ^/hooks/ecpay/(payment|payment-info|logistics)$
    service: http://drn-backend:9000
  - hostname: drn-api.example.tw
    path: ^/health$
    service: http://drn-backend:9000
  - hostname: drn-api.example.tw
    path: (?i)^/+(health|hooks/+ecpay)
    service: http_status:404
  - hostname: drn-api.example.tw
    service: http://drn-backend:9000
  - service: http_status:404
`);
});

test("hooks-only (default): /hooks/ecpay/ and /health only, everything else 404", () => {
  const c = ctx();
  const r = run(c, ["drn-api.example.tw"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rules(c), `  - hostname: drn-api.example.tw
    path: ^/hooks/ecpay/
    service: http://drn-backend:9000
  - hostname: drn-api.example.tw
    path: ^/health$
    service: http://drn-backend:9000
  - service: http_status:404
`);
});

test("a failed ingress validate fails the script; an unknown mode exits 2", () => {
  const bad = ctx({ validateFails: true });
  const r = run(bad, ["drn-api.example.tw", "public"]);
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /mode=public/);
  const c = ctx();
  assert.equal(run(c, ["drn-api.example.tw", "everything"]).status, 2);
});
