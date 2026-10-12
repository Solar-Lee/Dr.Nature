import vectors from "./fixtures/ecpay-vectors.json"
import {
  checkMacSourceString,
  computeCheckMacValue,
  ecpayUrlEncode,
  verifyCheckMacValue,
} from "../check-mac-value"

type Vector = {
  name: string
  method: string
  hashKey: string
  hashIV: string
  params: Record<string, string>
  expected: string
  wrong_with_percent20?: string
}

const algorithmOf = (method: string) => {
  if (method === "SHA256") {
    return "sha256" as const
  }
  if (method === "MD5") {
    return "md5" as const
  }
  throw new Error(`unknown method ${method}`)
}

const cmvVectors = vectors.checkMacValue as unknown as Vector[]

describe("ecpayUrlEncode", () => {
  it.each(vectors.urlEncode)("encodes %j like ECPay's .NET table", ({ input, expected }) => {
    expect(ecpayUrlEncode(input)).toEqual(expected)
  })

  it("uses + for spaces, never %20", () => {
    expect(ecpayUrlEncode("a b")).toEqual("a+b")
  })
})

describe("computeCheckMacValue", () => {
  it("covers both official worked examples and the published vectors", () => {
    expect(cmvVectors.length).toBeGreaterThanOrEqual(9)
    expect(cmvVectors.filter((v) => v.method === "MD5").length).toBeGreaterThanOrEqual(2)
  })

  it.each(cmvVectors.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    const actual = computeCheckMacValue(v.params, {
      hashKey: v.hashKey,
      hashIV: v.hashIV,
      algorithm: algorithmOf(v.method),
    })
    expect(actual).toEqual(v.expected)
    if (v.wrong_with_percent20) {
      expect(actual).not.toEqual(v.wrong_with_percent20)
    }
  })

  it("ignores an incoming CheckMacValue field when computing", () => {
    const v = cmvVectors[0]
    const opts = { hashKey: v.hashKey, hashIV: v.hashIV, algorithm: algorithmOf(v.method) }
    expect(computeCheckMacValue({ ...v.params, CheckMacValue: "X" }, opts)).toEqual(v.expected)
  })

  it("does not depend on parameter insertion order", () => {
    const v = cmvVectors[0]
    const reversed = Object.fromEntries(Object.entries(v.params).reverse())
    const opts = { hashKey: v.hashKey, hashIV: v.hashIV, algorithm: algorithmOf(v.method) }
    expect(computeCheckMacValue(reversed, opts)).toEqual(v.expected)
  })

  it("sorts keys case-insensitively like ECPay's PHP SDK (strcasecmp)", () => {
    const opts = { hashKey: "K", hashIV: "I", algorithm: "sha256" as const }
    expect(checkMacSourceString({ gamma: "3", Beta: "2", alpha: "1" }, opts)).toEqual(
      "HashKey=K&alpha=1&Beta=2&gamma=3&HashIV=I"
    )
    // ATM payment-info callbacks mix cases (e.g. vAccount); a case-sensitive sort would differ.
    expect(checkMacSourceString({ vAccount: "1", Alipay: "2", ATMAccBank: "3" }, opts)).toEqual(
      "HashKey=K&Alipay=2&ATMAccBank=3&vAccount=1&HashIV=I"
    )
  })

  it("refuses to sign without keys", () => {
    expect(() =>
      computeCheckMacValue({ a: "1" }, { hashKey: "", hashIV: "x", algorithm: "sha256" })
    ).toThrow()
  })
})

describe("verifyCheckMacValue", () => {
  const v = cmvVectors[0]
  const opts = { hashKey: v.hashKey, hashIV: v.hashIV, algorithm: algorithmOf(v.method) }

  it("accepts the genuine value (case-insensitive)", () => {
    expect(verifyCheckMacValue({ ...v.params, CheckMacValue: v.expected }, opts)).toBe(true)
    expect(
      verifyCheckMacValue({ ...v.params, CheckMacValue: v.expected.toLowerCase() }, opts)
    ).toBe(true)
  })

  it("rejects a tampered amount", () => {
    const tampered = { ...v.params, TotalAmount: "1", CheckMacValue: v.expected }
    expect(verifyCheckMacValue(tampered, opts)).toBe(false)
  })

  it("rejects a value signed with another merchant's keys", () => {
    const other = { ...opts, hashKey: "XBERn1YOvpM9nfZc", hashIV: "h1ONHk4P4yqbl5LK" }
    expect(verifyCheckMacValue({ ...v.params, CheckMacValue: v.expected }, other)).toBe(false)
  })

  it("rejects missing, non-hex and truncated values", () => {
    expect(verifyCheckMacValue({ ...v.params }, opts)).toBe(false)
    expect(verifyCheckMacValue({ ...v.params, CheckMacValue: "not-hex!" }, opts)).toBe(false)
    expect(
      verifyCheckMacValue({ ...v.params, CheckMacValue: v.expected.slice(0, 10) }, opts)
    ).toBe(false)
  })
})
