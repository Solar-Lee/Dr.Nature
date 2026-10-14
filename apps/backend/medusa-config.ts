import { ContainerRegistrationKeys, Modules, loadEnv, defineConfig } from "@medusajs/framework/utils"
import { authProvidersFromEnv } from "./src/lib/auth/config"
import { databaseDriverOptionsFromEnv } from "./src/lib/database/config"
import { emailDeliveryFromEnv } from "./src/lib/email/config"
import {
  ecpayInvoiceConfigured,
  ecpayInvoiceOptionsFromEnv,
  ecpayLogisticsOptionsFromEnv,
  ecpayOptionsFromEnv,
} from "./src/lib/ecpay/config"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// Variable names must stay within docs/ENV.md (checked by scripts/check-env-names.mjs).
// Module options follow the Medusa deployment guide (docs.medusajs.com/learn/deployment/general),
// verified against Medusa 2.21.2 on 2026-10-13.
// A database reached over a network must use TLS with certificate verification; startup fails
// closed without the CA. The machine itself and the compose-internal drn-postgres are exempt, and
// the pg host-override query parameters are refused (src/lib/database/config.ts, D8).
const databaseUrl = process.env.DATABASE_URL
const databaseDriverOptions = databaseDriverOptionsFromEnv()

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
// E-invoicing (P4-06) is not a module, but a bad production config (public test merchant,
// test host override, wrong key length) must stop the boot, like payment and logistics.
if (ecpayInvoiceConfigured()) {
  ecpayInvoiceOptionsFromEnv()
}
// E-mail delivery (verification codes, P5-01 review auth-2): a bad EMAIL_PROVIDER stops the boot.
emailDeliveryFromEnv()

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

// Customer login (P5-01): e-mail + password, plus Google / LINE when configured. Replacing the
// auth module's options drops Medusa's default emailpass entry, so it is listed again. OAuth
// state lives in the cache module (Medusa 2.21.2 auth-module setState/getState), hence the
// explicit dependency; the default in-memory cache is enough for ONE server process (state
// lasts 20 minutes and is lost on restart; several server replicas would need cache-redis).
const auth = authProvidersFromEnv()
const authModule = {
  resolve: "@medusajs/medusa/auth",
  dependencies: [Modules.CACHE, ContainerRegistrationKeys.LOGGER],
  options: { providers: auth.providers },
}

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
      authMethodsPerActor: { user: ["emailpass"], customer: auth.customerMethods },
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
  modules: [...redisModules, { resolve: "@medusajs/medusa/rbac" }, authModule, ...paymentModules, ...fulfillmentModules],
})
