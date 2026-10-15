// Database driver options (P3 review F1; Mac mini host, DEV_PLAN A7; P12-14).
// Medusa 2.21.2 defaults to ssl=false (utils create-pg-connection), so a database reached over a
// network must use TLS with certificate verification, and startup fails closed without the CA.
// Exempt: the machine itself, and drn-postgres, the compose service that is reachable only on the
// internal network drn_net (it publishes no host port; infra/docker-compose.prod.yml). The host
// name must match exactly (WHATWG URL does not lower-case it, so "DRN-POSTGRES" is not exempt).
//
// pg-connection-string (used by pg) lets the query parameters `host` and `hostaddr` override the
// host in the URL, while WHATWG URL still reports the URL host. A URL such as
// postgres://u:p@drn-postgres/db?host=evil.example.com would therefore look exempt here and
// connect in plain text elsewhere, so those two parameters are refused outright (D8). This
// project never uses them.
import { readFileSync } from "fs"
import { MedusaError } from "@medusajs/framework/utils"

export const PLAIN_DATABASE_HOSTS = ["", "localhost", "127.0.0.1", "::1", "drn-postgres"]
const HOST_OVERRIDE_PARAMS = ["host", "hostaddr"]

export function databaseHost(databaseUrl: string | undefined): string {
  try {
    return databaseUrl ? new URL(databaseUrl).hostname : ""
  } catch {
    return ""
  }
}

export function hostOverrideParams(databaseUrl: string | undefined): string[] {
  try {
    const params = databaseUrl ? new URL(databaseUrl).searchParams : new URLSearchParams()
    return HOST_OVERRIDE_PARAMS.filter((name) => params.has(name))
  } catch {
    return []
  }
}

export function databaseDriverOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  readCa: (path: string) => string = (path) => readFileSync(path, "utf8")
) {
  const overrides = hostOverrideParams(env.DATABASE_URL)
  if (overrides.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `DATABASE_URL must not override the host with query parameters (${overrides.join(", ")})`
    )
  }
  const host = databaseHost(env.DATABASE_URL)
  if (PLAIN_DATABASE_HOSTS.includes(host)) {
    return undefined
  }
  const caPath = env.DATABASE_SSL_CA_PATH
  if (!caPath) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `DATABASE_SSL_CA_PATH is required for non-local database host ${host}`
    )
  }
  return {
    connection: { ssl: { ca: readCa(caPath), rejectUnauthorized: true } },
  }
}
