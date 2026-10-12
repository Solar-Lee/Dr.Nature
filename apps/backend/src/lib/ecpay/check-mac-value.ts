// ECPay CheckMacValue (P4-02). Pure functions, no I/O.
//
// Algorithm (developers.ecpay.com.tw/2902/ for payments, /7424/ for logistics):
//   1. drop CheckMacValue, sort the remaining parameter names A-Z (case-insensitive)
//   2. join as key=value with "&", wrap as "HashKey=<key>&...&HashIV=<iv>"
//   3. URL-encode with ECPay's .NET table: space -> "+", - _ . ! * ( ) stay literal,
//      ' -> %27, ~ -> %7e
//   4. lowercase the whole string
//   5. SHA256 (payments, EncryptType=1) or MD5 (logistics, e-invoice allowance callback)
//   6. uppercase hex
// Verified against the official worked examples and ECPay's published test vectors
// (src/lib/ecpay/__tests__/fixtures/ecpay-vectors.json). See docs/research/ecpay.md.
import { createHash, timingSafeEqual } from "crypto"
import { MedusaError } from "@medusajs/framework/utils"

export type CheckMacAlgorithm = "sha256" | "md5"

export type CheckMacOptions = {
  hashKey: string
  hashIV: string
  algorithm: CheckMacAlgorithm
}

export type EcpayParams = Record<string, string | number>

const CHECK_MAC_FIELD = "CheckMacValue"

// encodeURIComponent already leaves A-Z a-z 0-9 - _ . ! ~ * ' ( ) unescaped, which matches
// ECPay's .NET table except for ' and ~ (encoded there) and space ("+" there).
export function ecpayUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/'/g, "%27")
    .replace(/~/g, "%7e")
    .toLowerCase()
}

// Case-insensitive key order, as in ECPay's official PHP SDK
// (github.com/ECPay/SDK_PHP src/Services/ArrayService.php: uksort + strcasecmp).
export function checkMacSourceString(params: EcpayParams, options: CheckMacOptions): string {
  if (!options.hashKey || !options.hashIV) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPay hashKey and hashIV are required")
  }
  const keys = Object.keys(params)
    .filter((k) => k !== CHECK_MAC_FIELD)
    .sort((a, b) => {
      const la = a.toLowerCase()
      const lb = b.toLowerCase()
      return la < lb ? -1 : la > lb ? 1 : 0
    })
  const joined = keys.map((k) => `${k}=${String(params[k])}`).join("&")
  return `HashKey=${options.hashKey}&${joined}&HashIV=${options.hashIV}`
}

export function computeCheckMacValue(params: EcpayParams, options: CheckMacOptions): string {
  return createHash(options.algorithm)
    .update(ecpayUrlEncode(checkMacSourceString(params, options)), "utf8")
    .digest("hex")
    .toUpperCase()
}

// Constant-time check of the CheckMacValue carried inside `params` (e.g. a callback body).
// Returns false (never throws) for a missing or malformed value.
export function verifyCheckMacValue(params: EcpayParams, options: CheckMacOptions): boolean {
  const received = params[CHECK_MAC_FIELD]
  if (typeof received !== "string" || !/^[0-9a-fA-F]+$/.test(received)) {
    return false
  }
  const expected = computeCheckMacValue(params, options)
  const a = Buffer.from(received.toUpperCase(), "utf8")
  const b = Buffer.from(expected, "utf8")
  return a.length === b.length && timingSafeEqual(a, b)
}
