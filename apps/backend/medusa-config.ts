import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// Variable names must stay within docs/ENV.md (checked by scripts/check-env-names.mjs).
// Module options follow the Medusa deployment guide (docs.medusajs.com/learn/deployment/general),
// verified against Medusa 2.21.2 on 2026-10-13.
const redisUrl = process.env.REDIS_URL
const workerMode = (process.env.MEDUSA_WORKER_MODE || "shared") as
  | "shared"
  | "worker"
  | "server"

// Without REDIS_URL (local dev, unit tests) Medusa falls back to its in-memory
// event bus, workflow engine and locking. Production always sets REDIS_URL.
const redisModules = redisUrl
  ? [
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl,
        jobOptions: {
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 3600, count: 1000 },
        },
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: { redis: { redisUrl } },
    },
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/locking-redis",
            id: "locking-redis",
            is_default: true,
            options: { redisUrl },
          },
        ],
      },
    },
  ]
  : []

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl,
    workerMode,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
    backendUrl: process.env.MEDUSA_BACKEND_URL,
  },
  // Admin RBAC (roles per staff function, P3-07) is behind the `rbac` feature flag in
  // 2.21.2. defineConfig() decides whether to load the RBAC module before core flags are
  // registered, so the flag alone leaves the module disabled; the explicit module entry
  // below replaces the default (disabled) one. Verified in @medusajs/framework 2.21.2.
  featureFlags: { rbac: true },
  modules: [...redisModules, { resolve: "@medusajs/medusa/rbac" }],
})
