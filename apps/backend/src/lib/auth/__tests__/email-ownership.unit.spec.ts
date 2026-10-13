import crypto from "crypto"
import { emailProof, normalizeEmail, tokenHash } from "../email-ownership"

const verified = (entity_id: string) => ({ entity_type: "email", entity_id, verified_at: new Date() })

describe("e-mail ownership proof (review auth-2)", () => {
  it("normalises e-mails to trimmed lowercase", () => {
    expect(normalizeEmail("  Line-User@DRN.test ")).toBe("line-user@drn.test")
    expect(normalizeEmail(undefined)).toBe("")
  })

  it("Google: the identity's verified Google e-mail is proof (case-insensitive)", () => {
    expect(emailProof({ provider_identities: [{ provider: "google", user_metadata: { email: "Me@Gmail.com" } }] }, [], "me@gmail.com")).toBe("google")
    expect(emailProof({ provider_identities: [{ provider: "google", user_metadata: { email: "me@gmail.com" } }] }, [], "other@gmail.com")).toBeNull()
  })

  it("a verified row is proof; an unverified one is not", () => {
    expect(emailProof({ provider_identities: [{ provider: "line" }] }, [verified("a@drn.test")], "a@drn.test")).toBe("token")
    expect(emailProof({ provider_identities: [{ provider: "line" }] }, [{ entity_type: "email", entity_id: "a@drn.test", verified_at: null }], "a@drn.test")).toBeNull()
  })

  it("emailpass may claim only its login e-mail, and still needs proof", () => {
    const ep = { provider_identities: [{ provider: "emailpass", entity_id: "Own@drn.test" }] }
    expect(emailProof(ep, [verified("other@drn.test")], "other@drn.test")).toBeNull()
    expect(emailProof(ep, [], "own@drn.test")).toBeNull()
    expect(emailProof(ep, [verified("own@drn.test")], "own@drn.test")).toBe("token")
  })

  it("a LINE e-mail never counts", () => {
    expect(emailProof({ provider_identities: [{ provider: "line", user_metadata: { email: "l@drn.test" } }] }, [], "l@drn.test")).toBeNull()
  })

  it("token hash mirrors Medusa's sha256 hex", () => {
    expect(tokenHash("abc")).toBe(crypto.createHash("sha256").update("abc").digest("hex"))
  })
})
