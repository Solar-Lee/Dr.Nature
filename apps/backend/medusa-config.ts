import { readFileSync } from "fs"
import { MedusaError, loadEnv, defineConfig } from "@medusajs/framework/utils"
import { ecpayLogisticsOptionsFromEnv, ecpayOptionsFromEnv } from "./src/lib/ecpay/config"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// Variable names must stay within docs/ENV.md (checked by scripts/check-env-names.mjs).
// Module options follow the Medusa deployment guide (docs.medusajs.com/learn/deployment/general),
// verified against Medusa 2.21.2 on 2026-10-13.
// Non-local databases (Supabase in production) must use TLS with certificate
// verification. Medusa 2.21.2 defaults to ssl=false (utils create-pg-connection), so the
// CA must be supplied explicitly; startup fails closed if it is missing.
const databaseUrl = process.env.DATABASE_URL
const databaseHost = (() => {
  try {
    return databaseUrl ? new URL(databaseUrl).hostname : ""
  } catch {
    return ""
  }
})()
const isLocalDatabase = ["", "localhost", "127.0.0.1", "::1"].includes(databaseHost)
const databaseDriverOptions = isLocalDatabase
  ? undefined
  : (() => {
    const caPath = process.env.DATABASE_SSL_CA_PATH
    if (!caPath) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `DATABASE_SSL_CA_PATH is required for non-local database host ${databaseHost}`
      )
    }
    return {
      connection: { ssl: { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true } },
    }
  })()

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

// ECPay payment provider (pp_ecpay_ecpay). Registered only when ECPAY_ENV is set, so
// image builds need no credentials. Production cannot silently run without it: the
// drn-0005 migration script fails if the provider is missing.
const paymentModules = process.env.ECPAY_ENV
  ? [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          { resolve: "./src/modules/ecpay", id: "ecpay", options: ecpayOptionsFromEnv() },
        ],
      },
    },
  ]
  : []

// ECPay logistics (fulfillment provider "ecpay_logistics"), registered only when its
// credentials are set. The manual provider stays registered (Medusa's default entry).
// drn-0006 fails if the ECPay provider is missing, so production cannot run without it.
const fulfillmentModules = process.env.ECPAY_LOGISTICS_MERCHANT_ID
  ? [
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
          { resolve: "./src/modules/ecpay-logistics", id: "logistics", options: ecpayLogisticsOptionsFromEnv() },
        ],
      },
    },
  ]
  : []

module.exports = defineConfig({
  projectConfig: {
    databaseUrl,
    databaseDriverOptions,
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
  modules: [...redisModules, { resolve: "@medusajs/medusa/rbac" }, ...paymentModules, ...fulfillmentModules],
})
