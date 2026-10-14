import { databaseDriverOptionsFromEnv } from "../config"

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv
const readCa = (path: string) => `CA from ${path}`

describe("database driver options", () => {
  it("the machine itself and the compose-internal drn-postgres connect without TLS", () => {
    for (const url of [
      "",
      "postgres://localhost:55432/drn_dev",
      "postgres://127.0.0.1:55432/drn_dev",
      "postgres://drn:pw@drn-postgres:5432/drn",
      "postgres://drn:pw@drn-postgres:5432/drn?sslmode=disable",
    ]) {
      expect(databaseDriverOptionsFromEnv(env({ DATABASE_URL: url }), readCa)).toBeUndefined()
    }
  })

  it("any other host fails closed without a CA, and verifies the certificate with one", () => {
    for (const url of [
      "postgres://db.example.supabase.co:5432/postgres",
      "postgres://drn-postgres.example.com:5432/drn",
      "postgres://10.0.0.5:5432/drn",
    ]) {
      expect(() => databaseDriverOptionsFromEnv(env({ DATABASE_URL: url }), readCa)).toThrow(
        /DATABASE_SSL_CA_PATH is required/
      )
    }
    expect(
      databaseDriverOptionsFromEnv(
        env({ DATABASE_URL: "postgres://db.example.supabase.co:5432/postgres", DATABASE_SSL_CA_PATH: "/ca.crt" }),
        readCa
      )
    ).toEqual({ connection: { ssl: { ca: "CA from /ca.crt", rejectUnauthorized: true } } })
  })

  it("only the exact host name drn-postgres is exempt", () => {
    for (const url of [
      "postgres://DRN-POSTGRES:5432/x",
      "postgres://drn-postgres.:5432/x",
      "postgres://evil-drn-postgres:5432/x",
      "postgres://drn-postgres-evil:5432/x",
    ]) {
      expect(() => databaseDriverOptionsFromEnv(env({ DATABASE_URL: url }), readCa)).toThrow(
        /DATABASE_SSL_CA_PATH is required/
      )
    }
  })

  it("refuses the pg query parameters host and hostaddr, which override the URL host", () => {
    for (const url of [
      "postgres://u:p@drn-postgres:5432/db?host=evil.example.com",
      "postgres://u:p@drn-postgres:5432/db?hostaddr=1.2.3.4",
      "postgres://u:p@localhost:5432/db?sslmode=disable&host=evil.example.com",
      "postgres://u:p@db.example.supabase.co:5432/db?host=evil.example.com",
    ]) {
      expect(() =>
        databaseDriverOptionsFromEnv(env({ DATABASE_URL: url, DATABASE_SSL_CA_PATH: "/ca.crt" }), readCa)
      ).toThrow(/must not override the host with query parameters/)
    }
  })
})
