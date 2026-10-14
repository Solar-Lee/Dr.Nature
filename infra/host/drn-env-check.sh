#!/bin/bash
# [P12-17] Checks ~/drn/.env (or, with --host, ~/drn/host.env) for completeness WITHOUT printing
# any value: output is `missing=N forbidden=M` plus the names that are missing or forbidden.
#   bash ~/drn/bin/drn-env-check.sh            production .env
#   bash ~/drn/bin/drn-env-check.sh --host     host.env (Healthchecks ping URLs)
# Exit 0 only when missing=0 and forbidden=0 and the file is mode 600.
set -euo pipefail

mode="env"
if [ "${1:-}" = "--host" ]; then mode="host"; fi

if [ "$mode" = "host" ]; then
  file="$HOME/drn/host.env"
  required=(DRN_API_HOST DRN_HC_HEARTBEAT_URL DRN_HC_ALERT_URL DRN_HC_ACCESS_URL DRN_HC_BACKUP_URL DRN_HC_DRILL_URL)
  forbidden=()
else
  file="$HOME/drn/.env"
  required=(
    POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DATABASE_URL JWT_SECRET COOKIE_SECRET
    STORE_CORS ADMIN_CORS AUTH_CORS MEDUSA_BACKEND_URL STOREFRONT_URL MEDUSA_DISABLE_TELEMETRY
    ECPAY_ENV ECPAY_MERCHANT_ID ECPAY_HASH_KEY ECPAY_HASH_IV
    ECPAY_LOGISTICS_MERCHANT_ID ECPAY_LOGISTICS_HASH_KEY ECPAY_LOGISTICS_HASH_IV ECPAY_LOGISTICS_CONTRACT
    ECPAY_LOGISTICS_SENDER_NAME ECPAY_LOGISTICS_SENDER_CELLPHONE
  )
  # Test-only overrides and stage-only switches must never be set on the production host
  # (medusa-config refuses most of them in prod, but the drill flag is stage-only by design).
  forbidden=(EMAIL_PROVIDER ECPAY_API_BASE_URL ECPAY_LOGISTICS_API_BASE_URL ECPAY_INVOICE_API_BASE_URL LINE_LOGIN_API_BASE_URL ECPAY_ACCEPT_SIMULATED_PAYMENTS TZ REDIS_URL MEDUSA_WORKER_MODE DISABLE_MEDUSA_ADMIN)
fi

if [ ! -f "$file" ]; then
  echo "drn-env-check: $file not found" >&2
  echo "missing=${#required[@]} forbidden=0"
  printf 'missing %s\n' "${required[@]}"
  exit 1
fi

# Names that have a non-empty value.
present="$(grep -E '^[A-Z0-9_]+=.+' "$file" | cut -d= -f1 | sort -u || true)"
missing=0; forbid=0
report=()
for name in "${required[@]}"; do
  if ! printf '%s\n' "$present" | grep -qx "$name"; then missing=$((missing+1)); report+=("missing $name"); fi
done
for name in "${forbidden[@]}"; do
  if printf '%s\n' "$present" | grep -qx "$name"; then forbid=$((forbid+1)); report+=("forbidden $name"); fi
done
perm="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file")"
echo "missing=$missing forbidden=$forbid"
for r in "${report[@]:-}"; do [ -n "$r" ] && echo "$r"; done
if [ "$perm" != "600" ]; then echo "mode $perm (expected 600)"; exit 1; fi
[ "$missing" -eq 0 ] && [ "$forbid" -eq 0 ]
