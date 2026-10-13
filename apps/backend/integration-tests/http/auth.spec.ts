// [P5-01] Customer login: e-mail + password, LINE Login (against a local stub of api.line.me that
// behaves like LINE: the ID token carries the nonce from the authorize step and /verify refuses a
// different nonce), and Google up to the redirect.
//
// What these tests cannot prove: the real LINE and Google consent screens, Google's token
// exchange and RS256 ID-token check (needs Google's servers and a real client), and that the
// callback URLs are registered in the LINE / Google consoles (Aki, U-17). Medusa's own
// auth-google is used unchanged.
//
// Run: cd apps/backend && ../../infra/test-env.sh env TEST_TYPE=integration:http \
//   NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --forceExit integration-tests/http/auth.spec.ts
import http from "http"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { OAUTH_CALLBACK_PATHS } from "../../src/lib/auth/config"
import { makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"

// Fake test values (not real credentials); set before the app boots so the providers register.
const LINE_CHANNEL = "1650000000"
process.env.LINE_LOGIN_CHANNEL_ID = LINE_CHANNEL
process.env.LINE_LOGIN_CHANNEL_SECRET = "line-test-secret-not-real"
process.env.LINE_LOGIN_API_BASE_URL = "http://127.0.0.1:56393"
process.env.GOOGLE_OAUTH_CLIENT_ID = "google-test-client.apps.googleusercontent.com"
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-test-secret-not-real"

jest.setTimeout(120 * 1000)

type Seen = { path: string; form: Record<string, string> }

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const h = makeCheckoutHelpers({ api, getContainer })
    let stub: http.Server
    let seen: Seen[] = []
    // LINE user per authorization code: "code-<sub>-<nonce>"
    beforeAll(async () => {
      await runAllSeeds(getContainer())
      stub = http.createServer((req, res) => {
        let raw = ""
        req.on("data", (c) => (raw += c))
        req.on("end", () => {
          const form = Object.fromEntries(new URLSearchParams(raw))
          seen.push({ path: req.url ?? "", form })
          const reply = (status: number, body: unknown) => {
            res.writeHead(status, { "content-type": "application/json" })
            res.end(JSON.stringify(body))
          }
          if (req.url === "/oauth2/v2.1/token") {
            const m = /^code-([^-]+)-([0-9a-f]+)$/.exec(form.code ?? "")
            if (!m || form.client_secret !== process.env.LINE_LOGIN_CHANNEL_SECRET || form.client_id !== LINE_CHANNEL || form.grant_type !== "authorization_code") {
              return reply(400, { error: "invalid_grant", error_description: "invalid authorization code" })
            }
            return reply(200, { access_token: "at", token_type: "Bearer", expires_in: 2592000, scope: "profile openid", id_token: `idt.${m[1]}.${m[2]}` })
          }
          if (req.url === "/oauth2/v2.1/verify") {
            const [, sub, nonce] = (form.id_token ?? "").split(".")
            if (!sub || form.client_id !== LINE_CHANNEL) return reply(400, { error: "invalid_request", error_description: "Invalid IdToken." })
            if (form.nonce && form.nonce !== nonce) return reply(400, { error: "invalid_request", error_description: "Invalid IdToken Nonce." })
            // Test hooks: sub "Xaud..." = token issued to another channel, "Xiss..." = another issuer.
            return reply(200, {
              iss: sub.startsWith("Xiss") ? "https://evil.example" : "https://access.line.me",
              sub,
              aud: sub.startsWith("Xaud") ? "1659999999" : LINE_CHANNEL,
              exp: 4102444800,
              iat: 1791820000,
              nonce,
              amr: ["linesso"],
              name: "測試 LINE",
              picture: "https://profile.line-scdn.net/x",
            })
          }
          reply(404, {})
        })
      })
      await new Promise<void>((r) => stub.listen(56393, "127.0.0.1", () => r()))
    })
    afterAll(async () => {
      await new Promise((r) => stub.close(r))
    })
    beforeEach(() => {
      seen = []
    })

    const startLine = async (body: Record<string, unknown> = {}) => {
      const res = await api.post("/auth/customer/line", body, { validateStatus: () => true })
      expect(res.status).toEqual(200)
      const url = new URL(res.data.location)
      return { url, state: url.searchParams.get("state")!, nonce: url.searchParams.get("nonce")! }
    }
    const lineCallback = (query: Record<string, string>) =>
      api.post(`/auth/customer/line/callback?${new URLSearchParams(query)}`, {}, { validateStatus: () => true })

    it("e-mail + password still works next to the OAuth providers", async () => {
      const m = await h.registerCustomer("emailpass@drn.test")
      const { data } = await api.get("/store/customers/me", { headers: m.headers })
      expect(data.customer.email).toEqual("emailpass@drn.test")
    })

    it("LINE: redirect with our callback, state and nonce; the callback creates the customer; next login finds them", async () => {
      const { url, state, nonce } = await startLine()
      expect(`${url.origin}${url.pathname}`).toEqual("https://access.line.me/oauth2/v2.1/authorize")
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        response_type: "code",
        client_id: LINE_CHANNEL,
        redirect_uri: `${process.env.STOREFRONT_URL}${OAUTH_CALLBACK_PATHS.line}`,
        scope: "profile openid",
        bot_prompt: "normal",
      })
      expect(state).toMatch(/^[0-9a-f]{64}$/)
      // A caller cannot redirect the code elsewhere.
      const hijack = await startLine({ callback_url: "https://evil.example/cb" })
      expect(hijack.url.searchParams.get("redirect_uri")).toEqual(`${process.env.STOREFRONT_URL}${OAUTH_CALLBACK_PATHS.line}`)
      expect(nonce).toMatch(/^[0-9a-f]{32}$/)

      const first = await lineCallback({ code: `code-U1001-${nonce}`, state })
      expect(first.status).toEqual(200)
      expect(seen.map((s) => s.path)).toEqual(["/oauth2/v2.1/token", "/oauth2/v2.1/verify"])
      expect(seen[0].form).toMatchObject({ redirect_uri: `${process.env.STOREFRONT_URL}${OAUTH_CALLBACK_PATHS.line}` })
      expect(seen[1].form).toMatchObject({ client_id: LINE_CHANNEL, nonce })

      // New LINE user: no customer yet. LINE gave no e-mail and Medusa 2.21.2 needs one, so the
      // storefront asks for it before creating the customer.
      const store = await h.storeHeaders()
      const auth = { ...store, authorization: `Bearer ${first.data.token}` }
      const noEmail = await api.post("/store/customers", { first_name: "測試", last_name: "LINE" }, { headers: auth, validateStatus: () => true })
      expect({ status: noEmail.status, message: noEmail.data.message }).toEqual({ status: 400, message: "Email is required to create a customer" })
      const created = await api.post("/store/customers", { email: "line-user@drn.test", first_name: "測試", last_name: "LINE" }, { headers: auth, validateStatus: () => true })
      expect(created.status).toEqual(200)
      const { data: refreshed } = await api.post("/auth/token/refresh", {}, { headers: { authorization: `Bearer ${first.data.token}` } })
      const me = await api.get("/store/customers/me", { headers: { ...store, authorization: `Bearer ${refreshed.token}` } })
      expect(me.data.customer.id).toEqual(created.data.customer.id)

      // Second login with the same LINE account: straight to the same customer.
      const again = await startLine()
      const second = await lineCallback({ code: `code-U1001-${again.nonce}`, state: again.state })
      expect(second.status).toEqual(200)
      const me2 = await api.get("/store/customers/me", { headers: { ...store, authorization: `Bearer ${second.data.token}` } })
      expect(me2.data.customer.id).toEqual(created.data.customer.id)
    })

    it("LINE: a reused, unknown or missing state, a foreign nonce, a refused code and a cancelled consent all fail", async () => {
      const a = await startLine()
      expect((await lineCallback({ code: `code-U2002-${a.nonce}`, state: a.state })).status).toEqual(200)
      expect((await lineCallback({ code: `code-U2002-${a.nonce}`, state: a.state })).status).toEqual(401) // state is single use
      for (const state of ["f".repeat(64), undefined]) {
        const r = await lineCallback({ code: `code-U2002-${a.nonce}`, ...(state ? { state } : {}) })
        expect({ status: r.status, message: r.data.message }).toEqual({ status: 401, message: "No state provided, or session expired" })
      }

      const b = await startLine()
      const foreign = await lineCallback({ code: `code-U2002-${"0".repeat(32)}`, state: b.state }) // token minted for another login
      expect(foreign.status).toEqual(401)
      expect(JSON.stringify(foreign.data)).toContain("Nonce")

      const d = await startLine()
      expect((await lineCallback({ code: `code-XaudU3-${d.nonce}`, state: d.state })).status).toEqual(401) // token for another channel
      const e = await startLine()
      expect((await lineCallback({ code: `code-XissU3-${e.nonce}`, state: e.state })).status).toEqual(401) // not issued by LINE

      const c = await startLine()
      expect((await lineCallback({ code: "stolen", state: c.state })).status).toEqual(401)
      expect((await lineCallback({ error: "access_denied", error_description: "The resource owner or authorization server denied the request.", state: c.state })).status).toEqual(401)
      // The channel secret only ever goes to the token endpoint.
      expect(seen.filter((s) => s.path === "/oauth2/v2.1/verify").some((s) => "client_secret" in s.form)).toBe(false)
    })

    it("Google: redirect with our callback and a fresh state; a forged state is refused", async () => {
      const res = await api.post("/auth/customer/google", {}, { validateStatus: () => true })
      expect(res.status).toEqual(200)
      const url = new URL(res.data.location)
      expect(`${url.origin}${url.pathname}`).toEqual("https://accounts.google.com/o/oauth2/v2/auth")
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        redirect_uri: `${process.env.STOREFRONT_URL}${OAUTH_CALLBACK_PATHS.google}`,
        response_type: "code",
      })
      // The message, not just 401: a missing state check would also end in 401 (failed token exchange).
      const forged = await api.post(`/auth/customer/google/callback?code=x&state=${"a".repeat(64)}`, {}, { validateStatus: () => true })
      expect({ status: forged.status, message: forged.data.message }).toEqual({ status: 401, message: "No state provided, or session expired" })
    })

    it("staff cannot log in with LINE or Google", async () => {
      expect((await api.post("/auth/user/line", {}, { validateStatus: () => true })).status).not.toEqual(200)
      expect((await api.post("/auth/user/google", {}, { validateStatus: () => true })).status).not.toEqual(200)
    })
  },
})
