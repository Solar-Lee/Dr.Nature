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

if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "$#" -gt 0 ]; then
  exec "$@"
fi
