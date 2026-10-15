#!/bin/bash
# [P12-28] Measures what a container can reach ON THE HOST (Docker Desktop variant of deployment
# review D24). Runs drn-probe.mjs in a one-off container (the Node image pinned in
# infra/backend.Dockerfile) on a temporary network drn_probe_tmp, or on --network <name>.
# Targets: host.docker.internal and gateway.docker.internal as the container resolves them, plus
# the network's gateway. Ports: the host's listening TCP ports as seen by lsof, plus 22/3283/5900,
# or every port with --full. --control first starts a listener on 9999 inside the same network and
# requires the probe to report it open (positive control). --dns checks that
# region1.v2.argotunnel.com resolves inside the container (cloudflared needs it).
# Exit 0 when nothing is open, 1 when something is, 2 on errors. Docker Desktop has no VM-side
# firewall hook, so this script only MEASURES; what to do with open host ports is Aki's decision
# (docs/ops/deploy-backend.md, D24).
set -euo pipefail
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
node_image="$(sed -nE 's/^FROM (node:[^ ]+) AS build$/\1/p' "$drn_dir/backend.Dockerfile" 2>/dev/null || true)"
[ -n "$node_image" ] || node_image="node:22.22.3-alpine3.22@sha256:cd7807368cf24826297cbad5dca1a44972ccfd770647db52a8c7589eb4599ac8"

network=""; full=0; control=0; dns=0
while [ $# -gt 0 ]; do
  case "$1" in
    --network) network="$2"; shift 2 ;;
    --full) full=1; shift ;;
    --control) control=1; shift ;;
    --dns) dns=1; shift ;;
    *) echo "drn-probe: unknown argument $1" >&2; exit 2 ;;
  esac
done

tmp_net=""
if [ -z "$network" ]; then
  network="drn_probe_tmp"; tmp_net="$network"
  "$drn_docker" network create "$network" >/dev/null
fi
control_name=""
cleanup() {
  [ -n "$control_name" ] && "$drn_docker" rm -f "$control_name" >/dev/null 2>&1 || true
  [ -n "$tmp_net" ] && "$drn_docker" network rm "$tmp_net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

gateway="$("$drn_docker" network inspect -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' "$network")"
rand="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"

if [ "$dns" = 1 ]; then
  if "$drn_docker" run --rm --network "$network" --name "drn-probe-dns-$rand" "$node_image" node -e 'require("dns").promises.lookup("region1.v2.argotunnel.com").then(r=>{console.log("dns-ok",r.address)}).catch(e=>{console.log("dns-fail",e.code);process.exit(1)})'; then exit 0; else exit 1; fi
fi

if [ "$full" = 1 ]; then
  ports="1-65535"
else
  ports="$( { lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $9}' | sed -E 's/.*:([0-9]+)$/\1/'; echo 22; echo 3283; echo 5900; } | sort -un | paste -sd, -)"
fi
targets="host.docker.internal,gateway.docker.internal,$gateway"
if [ "$control" = 1 ]; then
  control_name="drn-probe-control-$rand"
  "$drn_docker" run -d --rm --network "$network" --name "$control_name" "$node_image" node -e 'require("net").createServer(s=>s.end()).listen(9999,"0.0.0.0")' >/dev/null
  sleep 2
  targets="$targets,$control_name"
  ports="$ports,9999"
fi

set +e
"$drn_docker" run --rm -i --network "$network" --name "drn-probe-$rand" --memory 128m "$node_image" node - --targets "$targets" --ports "$ports" < "$drn_dir/bin/drn-probe.mjs"
code=$?
set -e
if [ "$control" = 1 ]; then
  # Positive control: the probe MUST have found the control listener (exit 1 with it in the list).
  [ "$code" = 1 ] || { echo "drn-probe: control listener not detected; probe is not trustworthy" >&2; exit 2; }
fi
exit "$code"
