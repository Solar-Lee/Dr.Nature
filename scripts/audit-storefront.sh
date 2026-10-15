#!/usr/bin/env bash
# [PERF-07 / PF-04] Manual accessibility + performance gate for the storefront static export.
#
#   bash scripts/audit-storefront.sh [--out DIR] [--port N] [--lcp-budget-ms MS] [--cls-budget X]
#
#   --out            static export to audit (default apps/storefront/out; build it first with
#                    `pnpm --dir apps/storefront exec next build`)
#   --port           127.0.0.1 port of the local gzip static server (default 3072; lane range 3070-3079)
#   --lcp-budget-ms  fail when Lighthouse mobile LCP is above this (default 4000 for now; the DEV_PLAN
#                    goal is 2500 ms, the 2026-10-14 baseline was 8.8 s)
#   --cls-budget     fail when Lighthouse mobile CLS is above this (default 0.1)
#
# Checks (all numbers are always printed):
#   1. axe-core (@axe-core/cli, Chrome headless, 4 s load delay) on every out/**/index.html:
#      any violation with impact serious or critical -> fail.
#   2. Lighthouse mobile (default config: Moto G Power emulation, simulated throttling) on / and
#      /products/daily/: LCP over budget, CLS over budget, or any request to fonts.googleapis.com
#      (self-hosting the font is a PF task) -> fail.
# Exit codes: 0 every check passed; 1 a check failed; 2 usage error, missing build, busy port, or a
# tool that did not produce results (never "green on nothing").
#
# NOT part of scripts/test-all.sh, on purpose: it needs Google Chrome installed, fetches the two
# pinned tools with npx (network; @axe-core/cli also pulls the latest chromedriver, which must match
# the installed Chrome), takes a few minutes, and Lighthouse timings vary between machines and runs.
# Run it by hand as the acceptance command of the a11y / performance tasks
# (docs/ops/preview-storefront.md §2). Writes only to a fresh temp directory, never inside the repo.
set -uo pipefail

AXE_VERSION="4.13.0" # npm view @axe-core/cli version -> 4.13.0 (2026-10-15; published 2026-08-11)
LH_VERSION="13.5.0"  # npm view lighthouse version    -> 13.5.0 (2026-10-15; published 2026-09-18)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/apps/storefront/out"
PORT=3072
LCP_BUDGET_MS=4000
CLS_BUDGET=0.1

usage() { sed -n '4,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --lcp-budget-ms) LCP_BUDGET_MS="${2:-}"; shift 2 ;;
    --cls-budget) CLS_BUDGET="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "audit-storefront: unknown argument $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$PORT" =~ ^[0-9]+$ ]] || { echo "audit-storefront: --port needs a number" >&2; exit 2; }
[[ "$LCP_BUDGET_MS" =~ ^[0-9]+$ ]] || { echo "audit-storefront: --lcp-budget-ms needs a number" >&2; exit 2; }
[[ "$CLS_BUDGET" =~ ^[0-9]*\.?[0-9]+$ ]] || { echo "audit-storefront: --cls-budget needs a number" >&2; exit 2; }

OUT="$(cd "$OUT" 2>/dev/null && pwd)" || { echo "audit-storefront: export directory not found; build it first: pnpm --dir apps/storefront exec next build" >&2; exit 2; }
if [ ! -f "$OUT/index.html" ]; then
  echo "audit-storefront: $OUT/index.html is missing; build it first: pnpm --dir apps/storefront exec next build" >&2
  exit 2
fi
BASE="http://127.0.0.1:$PORT"
if curl -s -o /dev/null --max-time 2 "$BASE/"; then
  echo "audit-storefront: something already answers on $BASE; pick another --port" >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/drn-audit-storefront.XXXXXX")"
echo "audit-storefront: export $OUT, results in $WORK"

# Static server shaped like infra/nginx/drn.conf after PF-01: try_files $uri $uri/ =404 with
# /404.html, gzip for text types, immutable caching for /_next/static/.
cat >"$WORK/server.cjs" <<'JS'
const http = require("http"), fs = require("fs"), path = require("path"), zlib = require("zlib");
const root = process.argv[2], port = Number(process.argv[3]);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".glb": "model/gltf-binary" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  let status = 200;
  if (!fs.existsSync(f)) { f = path.join(root, "404.html"); status = 404; }
  const type = types[path.extname(f)] || "application/octet-stream";
  const body = fs.readFileSync(f);
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  if (p.startsWith("/_next/static/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  if (/gzip/.test(req.headers["accept-encoding"] || "") && /^(text|application\/json|image\/svg)/.test(type)) {
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    return res.end(zlib.gzipSync(body, { level: 5 }));
  }
  res.end(body);
}).listen(port, "127.0.0.1");
JS
node "$WORK/server.cjs" "$OUT" "$PORT" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
for _ in $(seq 1 50); do curl -s -o /dev/null --max-time 1 "$BASE/" && break; sleep 0.2; done
curl -s -o /dev/null --max-time 2 "$BASE/" || { echo "audit-storefront: static server did not start (see $WORK/server.log)" >&2; exit 2; }

fails=()

# 1. axe-core on every exported page.
pages=()
while IFS= read -r rel; do pages+=("$BASE/${rel%index.html}"); done < <(cd "$OUT" && find . -name index.html -not -path './_next/*' | sed 's|^\./||' | sort)
echo "▶ axe-core $AXE_VERSION on ${#pages[@]} page(s)"
(cd "$WORK" && npx --yes "@axe-core/cli@$AXE_VERSION" "${pages[@]}" --load-delay 4000 --save axe.json --dir "$WORK" --no-reporter >"$WORK/axe.log" 2>&1)
if [ ! -s "$WORK/axe.json" ]; then
  echo "audit-storefront: axe produced no results (see $WORK/axe.log)" >&2
  tail -5 "$WORK/axe.log" >&2
  exit 2
fi
axe_bad="$(node -e '
  const runs = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const expected = Number(process.argv[2]);
  let bad = 0;
  for (const r of runs) {
    const hits = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    const s = hits.filter((v) => v.impact === "serious").length, c = hits.filter((v) => v.impact === "critical").length;
    bad += hits.length;
    console.error(`  axe ${new URL(r.url).pathname}: serious=${s} critical=${c}` + (hits.length ? "  " + hits.map((v) => `${v.id}(${v.impact},${v.nodes.length})`).join(" ") : ""));
  }
  if (runs.length !== expected) { console.error(`  axe returned ${runs.length} result(s) for ${expected} page(s)`); bad += 1000; }
  console.log(bad);
' "$WORK/axe.json" "${#pages[@]}")" || { echo "audit-storefront: could not read $WORK/axe.json" >&2; exit 2; }
if [ "$axe_bad" -ge 1000 ]; then echo "audit-storefront: axe skipped pages (see $WORK/axe.log)" >&2; exit 2; fi
echo "  axe total serious+critical violations: $axe_bad"
[ "$axe_bad" -eq 0 ] || fails+=("axe")

# 2. Lighthouse mobile on / and /products/daily/.
for path in "/" "/products/daily/"; do
  name="$(echo "$path" | tr -c 'a-z0-9\n' '-' | sed 's/^-*//; s/-*$//')"; name="lh-${name:-home}"
  echo "▶ lighthouse $LH_VERSION mobile $path"
  (cd "$WORK" && npx --yes "lighthouse@$LH_VERSION" "$BASE$path" --only-categories=performance --output=json \
    --output-path="$WORK/$name.json" --chrome-flags="--headless=new" --quiet >"$WORK/$name.log" 2>&1)
  if [ ! -s "$WORK/$name.json" ]; then
    echo "audit-storefront: lighthouse produced no report for $path (see $WORK/$name.log)" >&2
    tail -5 "$WORK/$name.log" >&2
    exit 2
  fi
  verdict="$(node -e '
    const lh = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const [lcpBudget, clsBudget] = [Number(process.argv[2]), Number(process.argv[3])];
    if (lh.runtimeError) { console.error("  lighthouse runtime error: " + lh.runtimeError.code); console.log("error"); process.exit(0); }
    const lcp = lh.audits["largest-contentful-paint"]?.numericValue;
    const cls = lh.audits["cumulative-layout-shift"]?.numericValue;
    const reqs = lh.audits["network-requests"]?.details?.items ?? [];
    const gf = reqs.filter((r) => /fonts\.googleapis\.com/.test(r.url)).length;
    if (typeof lcp !== "number" || typeof cls !== "number") { console.error("  lighthouse report has no LCP/CLS"); console.log("error"); process.exit(0); }
    const bad = [];
    if (lcp > lcpBudget) bad.push("lcp");
    if (cls > clsBudget) bad.push("cls");
    if (gf > 0) bad.push("fonts.googleapis.com");
    console.error(`  LCP ${Math.round(lcp)} ms (budget ${lcpBudget}) · CLS ${cls.toFixed(3)} (budget ${clsBudget}) · fonts.googleapis.com requests ${gf} · performance score ${Math.round((lh.categories.performance?.score ?? 0) * 100)}`);
    console.log(bad.join(","));
  ' "$WORK/$name.json" "$LCP_BUDGET_MS" "$CLS_BUDGET")" || { echo "audit-storefront: could not read $WORK/$name.json" >&2; exit 2; }
  if [ "$verdict" = "error" ]; then exit 2; fi
  for v in ${verdict//,/ }; do fails+=("$v:$path"); done
done

if [ "${#fails[@]}" -gt 0 ]; then
  echo "audit-storefront: FAILED (${fails[*]}); reports in $WORK"
  exit 1
fi
echo "audit-storefront: PASSED; reports in $WORK"
