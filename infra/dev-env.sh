#!/usr/bin/env bash
# Local development environment (values are local-only, not secrets).
# Usage: source infra/dev-env.sh   — or —   infra/dev-env.sh <command ...>
# Exported variables override apps/backend/.env because Medusa's loadEnv does not
# overwrite variables that are already set.
export NODE_ENV=development
export DATABASE_URL="postgres://drn:drn-local-dev@127.0.0.1:55432/drn_dev"
export REDIS_URL="redis://127.0.0.1:56379"
export JWT_SECRET="local-dev-jwt-not-secret"
export COOKIE_SECRET="local-dev-cookie-not-secret"
export STORE_CORS="http://localhost:8000"
export ADMIN_CORS="http://localhost:9000"
export AUTH_CORS="http://localhost:8000,http://localhost:9000"
export MEDUSA_BACKEND_URL="http://localhost:9000"
export MEDUSA_WORKER_MODE="shared"

export STOREFRONT_URL="http://localhost:8000"
# ECPay PUBLIC sandbox merchant published by ECPay (developers.ecpay.com.tw/2856/); not a secret.
export ECPAY_ENV="stage"
export ECPAY_MERCHANT_ID="3002607"
export ECPAY_HASH_KEY="pwFHCqoQZGmho4w6"
export ECPAY_HASH_IV="EkRm7iFT261dpevs"

if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "$#" -gt 0 ]; then
  exec "$@"
fi
