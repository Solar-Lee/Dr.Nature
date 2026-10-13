#!/usr/bin/env bash
# Environment for backend integration tests (@medusajs/test-utils 2.21.2).
# The test runner ignores DATABASE_URL and creates throwaway databases on the server
# given by DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD. DB_HOST must contain "localhost"
# or the runner turns on SSL. REDIS_URL is emptied so tests use in-memory modules.
# Requires: docker compose -f infra/docker-compose.dev.yml up -d
export NODE_ENV=test
export DB_HOST=localhost
export DB_PORT=55432
export DB_USERNAME=drn
export DB_PASSWORD=drn-local-dev
export REDIS_URL=
export JWT_SECRET="test-jwt-not-secret"
export COOKIE_SECRET="test-cookie-not-secret"

export MEDUSA_BACKEND_URL="http://localhost:9000"
export STOREFRONT_URL="http://localhost:8000"
# ECPay PUBLIC sandbox merchant published by ECPay (developers.ecpay.com.tw/2856/); not a secret.
# QueryTradeInfo is answered by a local stub started in the ECPay integration spec.
export ECPAY_ENV="stage"
export ECPAY_MERCHANT_ID="3002607"
export ECPAY_HASH_KEY="pwFHCqoQZGmho4w6"
export ECPAY_HASH_IV="EkRm7iFT261dpevs"
export ECPAY_API_BASE_URL="http://127.0.0.1:56390"
# Pinned so a developer's apps/backend/.env cannot change test behaviour (the one spec
# that needs it on sets it itself before the app boots).
export ECPAY_ACCEPT_SIMULATED_PAYMENTS=false

# ECPay PUBLIC C2C logistics sandbox merchant (developers.ecpay.com.tw/7398/); not a secret.
export ECPAY_LOGISTICS_MERCHANT_ID="2000933"
export ECPAY_LOGISTICS_HASH_KEY="XBERn1YOvpM9nfZc"
export ECPAY_LOGISTICS_HASH_IV="h1ONHk4P4yqbl5LK"
export ECPAY_LOGISTICS_CONTRACT="C2C"
# Test sender (fictional). Production: the real sender's personal name and cellphone.
export ECPAY_LOGISTICS_SENDER_NAME="王小明"
export ECPAY_LOGISTICS_SENDER_CELLPHONE="0912345678"
# Express/Create is answered by a local stub started in the logistics integration spec.
export ECPAY_LOGISTICS_API_BASE_URL="http://127.0.0.1:56391"

# Verification e-mails are written to the log in tests (EMAIL_PROVIDER=log is refused in production).
export EMAIL_PROVIDER=log

# E-invoicing stays OFF here; integration-tests/http/ecpay-invoice.spec.ts turns it on for
# itself (stub on 127.0.0.1:56392) so other suites' orders are never invoiced.

if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "$#" -gt 0 ]; then
  exec "$@"
fi
