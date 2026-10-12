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

# ECPay PUBLIC C2C logistics sandbox merchant (developers.ecpay.com.tw/7398/); not a secret.
export ECPAY_LOGISTICS_MERCHANT_ID="2000933"
export ECPAY_LOGISTICS_HASH_KEY="XBERn1YOvpM9nfZc"
export ECPAY_LOGISTICS_HASH_IV="h1ONHk4P4yqbl5LK"
export ECPAY_LOGISTICS_CONTRACT="C2C"
# Test sender (fictional). Production: the real sender's personal name and cellphone.
export ECPAY_LOGISTICS_SENDER_NAME="王小明"
export ECPAY_LOGISTICS_SENDER_CELLPHONE="0912345678"

# ECPay PUBLIC e-invoice sandbox merchant (developers.ecpay.com.tw/7849/); not a secret.
# Stage invoices are never uploaded to the Ministry of Finance.
export ECPAY_INVOICE_MERCHANT_ID="2000132"
export ECPAY_INVOICE_HASH_KEY="ejCk326UnaZWKisg"
export ECPAY_INVOICE_HASH_IV="q9jcZX8Ib9LM8wYk"

if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "$#" -gt 0 ]; then
  exec "$@"
fi
