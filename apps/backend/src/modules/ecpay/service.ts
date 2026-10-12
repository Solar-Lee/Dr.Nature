// ECPay AIO payment provider (P4-03): credit card and Apple Pay.
//
// Flow ("order first, then pay", the usual Taiwan checkout):
//  1. Storefront creates a payment session (provider pp_ecpay_ecpay, data.choose_payment).
//     initiatePayment signs the ECPay checkout form and returns it in session.data.
//  2. Storefront completes the cart. authorizePayment finds no proof of payment and returns
//     pending_authorization, so Medusa creates the order without a payment (no ECPay call).
//  3. Browser POSTs the form to ECPay; the shopper pays.
//  4. ECPay POSTs the signed ReturnURL notice to /hooks/ecpay/payment. The route verifies it,
//     attaches it to the session (updatePayment re-verifies), and runs processPaymentWorkflow;
//     authorizePayment now finds a verified notice and records the payment as captured
//     (AIO settles itself).
//
// Trust: payment_session.data is readable by shoppers and partly writable by them at
// creation, so "paid" is never read from a plain field. Only a payment proof signed with
// our merchant keys (ReturnURL notice, or QueryTradeInfo answer from reconciliation) and
// bound to this session's MerchantTradeNo, session id and amount counts as paid.
// Verified against Medusa 2.21.2 (docs/research/medusa-p3.md) and ECPay docs (docs/research/ecpay.md).
import crypto from "crypto"
import {
  AbstractPaymentProvider,
  BigNumber,
  MathBN,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  BigNumberInput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  SUPPORTED_CHOOSE_PAYMENT,
  buildCheckoutForm,
  buildQueryTradeInfoRequest,
  newMerchantTradeNo,
  parsePaymentNotice,
  parseTradeInfoResponse,
  paymentDeadlineIso,
  verifiedNoticeFor,
  verifiedPaymentInfoFor,
  verifiedTradeInfoFor,
  type ChoosePayment,
  type CheckoutForm,
  type MerchantCredentials,
  type PaymentInfoNotice,
  type TradeInfo,
} from "../../lib/ecpay/aio"
import type { EcpayProviderOptions } from "../../lib/ecpay/config"

type InjectedDependencies = { logger: Logger }

// The only keys this provider relies on; all are written by the provider itself.
export type EcpaySessionData = {
  session_id: string
  merchant_trade_no: string
  amount: number
  currency_code: "twd"
  choose_payment: ChoosePayment
  checkout_form: CheckoutForm
  ecpay_trade_no?: string
  ecpay_payment_type?: string
  // Signed payment proofs (raw ECPay fields incl. CheckMacValue); see verifiedNoticeFor.
  ecpay_notice?: Record<string, string>
  ecpay_trade_info?: Record<string, string>
  // ATM / CVS / BARCODE: signed PaymentInfoURL notice (code issued, NOT paid) and the
  // shopper-facing instructions derived from it (P4-04).
  ecpay_payment_info?: Record<string, string>
  ecpay_payment_instructions?: PaymentInstructions
}

export type PaymentInstructions = {
  payment_type: string
  bank_code?: string
  v_account?: string
  payment_no?: string
  barcodes?: [string, string, string]
  expire_date: string
  expires_at: string | null
}

type ProofOfPayment = { tradeNo: string; paymentType: string }

const QUERY_TIMEOUT_MS = 10_000

// Keys the provider owns. initiatePayment/updatePayment return them explicitly (null when
// unset) so values a shopper merged into session.data at creation are overwritten.
const PROVIDER_PROOF_KEYS = [
  "ecpay_notice",
  "ecpay_trade_info",
  "ecpay_payment_info",
  "ecpay_payment_instructions",
  "ecpay_trade_no",
  "ecpay_payment_type",
] as const

const clearedProofKeys = () =>
  Object.fromEntries(PROVIDER_PROOF_KEYS.map((k) => [k, null])) as Record<(typeof PROVIDER_PROOF_KEYS)[number], null>

function instructionsFrom(info: PaymentInfoNotice): PaymentInstructions {
  return {
    payment_type: info.paymentType,
    ...(info.bankCode ? { bank_code: info.bankCode, v_account: info.vAccount } : {}),
    ...(info.paymentNo ? { payment_no: info.paymentNo } : {}),
    ...(info.barcodes ? { barcodes: info.barcodes } : {}),
    expire_date: info.expireDate,
    expires_at: paymentDeadlineIso(info.expireDate),
  }
}

class EcpayPaymentProviderService extends AbstractPaymentProvider<EcpayProviderOptions> {
  static identifier = "ecpay"

  protected logger_: Logger
  protected options_: EcpayProviderOptions

  static validateOptions(options: Record<string, unknown>): void {
    for (const key of [
      "environment",
      "merchantId",
      "hashKey",
      "hashIV",
      "returnUrl",
      "orderResultUrl",
      "clientBackUrl",
      "checkoutUrl",
      "queryTradeInfoUrl",
      "paymentInfoUrl",
    ]) {
      if (typeof options?.[key] !== "string" || !options[key]) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `ECPay option "${key}" is required`)
      }
    }
    if (
      options.environment === "prod" &&
      (!String(options.returnUrl).startsWith("https://") || !String(options.paymentInfoUrl).startsWith("https://"))
    ) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPay ReturnURL/PaymentInfoURL must be HTTPS in prod")
    }
    if (typeof options.acceptSimulatedPayments !== "boolean") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `ECPay option "acceptSimulatedPayments" must be a boolean`)
    }
    if (options.environment === "prod" && options.acceptSimulatedPayments) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "simulated payments can never be accepted in prod")
    }
  }

  constructor(container: InjectedDependencies, options: EcpayProviderOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
  }

  protected get credentials(): MerchantCredentials {
    return {
      merchantId: this.options_.merchantId,
      hashKey: this.options_.hashKey,
      hashIV: this.options_.hashIV,
    }
  }

  protected toWholeTwd(amount: BigNumberInput, currency: string): number {
    if (currency.toLowerCase() !== "twd") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `ECPay supports TWD only, got ${currency}`)
    }
    const bn = MathBN.convert(amount)
    if (!bn.isFinite() || !bn.isInteger() || bn.lte(0)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `ECPay TotalAmount must be a positive whole TWD amount, got ${bn.toString()}`
      )
    }
    const n = bn.toNumber()
    if (!Number.isSafeInteger(n)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "amount out of range")
    }
    return n
  }

  protected choosePayment(data: Record<string, unknown> | undefined): ChoosePayment {
    const requested = data?.choose_payment ?? "Credit"
    if (!SUPPORTED_CHOOSE_PAYMENT.includes(requested as ChoosePayment)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `unsupported payment method ${String(requested)}`)
    }
    return requested as ChoosePayment
  }

  protected buildSession(
    sessionId: string,
    amount: number,
    choosePayment: ChoosePayment
  ): EcpaySessionData {
    const now = new Date()
    const merchantTradeNo = newMerchantTradeNo(now, crypto.randomBytes(6))
    const checkoutForm = buildCheckoutForm({
      credentials: this.credentials,
      environment: this.options_.environment,
      merchantTradeNo,
      tradeDate: now,
      totalAmount: amount,
      itemName: `Dr.Nature 訂單 ${merchantTradeNo}`,
      tradeDesc: "Dr.Nature",
      returnUrl: this.options_.returnUrl,
      orderResultUrl: this.options_.orderResultUrl,
      clientBackUrl: this.options_.clientBackUrl,
      choosePayment,
      customField1: sessionId,
      paymentInfoUrl: this.options_.paymentInfoUrl,
    })
    checkoutForm.action = this.options_.checkoutUrl
    return {
      session_id: sessionId,
      merchant_trade_no: merchantTradeNo,
      amount,
      currency_code: "twd",
      choose_payment: choosePayment,
      checkout_form: checkoutForm,
    }
  }

  protected readSession(data: Record<string, unknown> | undefined): EcpaySessionData {
    const d = data ?? {}
    if (
      typeof d.session_id !== "string" ||
      typeof d.merchant_trade_no !== "string" ||
      typeof d.amount !== "number"
    ) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPay session data is incomplete")
    }
    return d as unknown as EcpaySessionData
  }

  // A verified, session-bound proof of payment, or null. No network access.
  protected proofOfPayment(session: EcpaySessionData): ProofOfPayment | null {
    const binding = {
      merchantTradeNo: session.merchant_trade_no,
      sessionId: session.session_id,
      amount: session.amount,
    }
    const notice = verifiedNoticeFor(
      session.ecpay_notice,
      binding,
      this.credentials,
      this.options_.acceptSimulatedPayments
    )
    if (notice) {
      return { tradeNo: notice.tradeNo, paymentType: notice.paymentType }
    }
    const info = verifiedTradeInfoFor(session.ecpay_trade_info, binding, this.credentials)
    if (info) {
      return { tradeNo: info.tradeNo, paymentType: info.paymentType }
    }
    return null
  }

  // Rebuilds session data from the provider's own keys, dropping anything else a client
  // may have sent at session creation.
  // Rebuilds session data from the provider's own keys. ecpay_* proofs are carried over only
  // if they verify for this session, and payment instructions are always re-derived from a
  // verified code notice: a shopper can merge arbitrary data into payment_session.data at
  // creation, so nothing client-planted survives (P4-04 review).
  protected providerKeys(session: EcpaySessionData): EcpaySessionData {
    const binding = this.binding(session)
    const notice = verifiedNoticeFor(session.ecpay_notice, binding, this.credentials, this.options_.acceptSimulatedPayments)
    const tradeInfo = verifiedTradeInfoFor(session.ecpay_trade_info, binding, this.credentials)
    const info = verifiedPaymentInfoFor(session.ecpay_payment_info, binding, this.credentials)
    return {
      session_id: session.session_id,
      merchant_trade_no: session.merchant_trade_no,
      amount: session.amount,
      currency_code: "twd",
      choose_payment: session.choose_payment,
      checkout_form: session.checkout_form,
      ...(notice ? { ecpay_notice: session.ecpay_notice } : {}),
      ...(tradeInfo ? { ecpay_trade_info: session.ecpay_trade_info } : {}),
      ...(info
        ? { ecpay_payment_info: session.ecpay_payment_info, ecpay_payment_instructions: instructionsFrom(info) }
        : {}),
    }
  }

  protected binding(session: EcpaySessionData) {
    return {
      merchantTradeNo: session.merchant_trade_no,
      sessionId: session.session_id,
      amount: session.amount,
    }
  }

  // Server-to-server QueryTradeInfo. Returns null when ECPay cannot be reached or the
  // answer is not signed by our merchant keys; callers treat null as "not paid (yet)".
  protected async queryTradeInfo(merchantTradeNo: string): Promise<TradeInfo | null> {
    const body = new URLSearchParams(
      buildQueryTradeInfoRequest(this.credentials, merchantTradeNo, new Date())
    )
    try {
      const res = await fetch(this.options_.queryTradeInfoUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      })
      const text = await res.text()
      const info = parseTradeInfoResponse(text, this.credentials)
      if (!info) {
        this.logger_.warn(`ECPay QueryTradeInfo ${merchantTradeNo}: unsigned or invalid response (HTTP ${res.status})`)
      }
      return info
    } catch (e) {
      this.logger_.warn(`ECPay QueryTradeInfo ${merchantTradeNo} failed: ${(e as Error).message}`)
      return null
    }
  }

  protected statusFrom(info: TradeInfo | null, session: EcpaySessionData) {
    if (!info || info.merchantTradeNo !== session.merchant_trade_no || info.tradeStatus !== "1") {
      // Unpaid, unknown or unreachable: the order may be created, payment stays pending.
      return PaymentSessionStatus.PENDING_AUTHORIZATION
    }
    if (info.tradeAmt !== session.amount) {
      this.logger_.error(
        `ECPay amount mismatch for ${session.merchant_trade_no}: paid ${info.tradeAmt}, expected ${session.amount}`
      )
      return PaymentSessionStatus.ERROR
    }
    return PaymentSessionStatus.CAPTURED
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sessionId = input.data?.session_id
    if (typeof sessionId !== "string") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "session_id missing")
    }
    const amount = this.toWholeTwd(input.amount, input.currency_code)
    const data = this.buildSession(sessionId, amount, this.choosePayment(input.data))
    // session.data is visible to the shopper: it holds the signed form, never HashKey/HashIV.
    return {
      id: data.merchant_trade_no,
      data: { ...clearedProofKeys(), ...data },
      status: PaymentSessionStatus.PENDING,
    }
  }

  // The module replaces session.data with what this returns.
  // - With a payment proof (ReturnURL route / reconciliation): keep the trade, attach the
  //   proof only if it verifies for this exact session; a paid trade is never re-priced.
  // - Otherwise (amount changed): issue a new MerchantTradeNo and form, because ECPay never
  //   re-prices an issued trade number.
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const sessionId = input.data?.session_id
    if (typeof sessionId !== "string") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "session_id missing")
    }
    const amount = this.toWholeTwd(input.amount, input.currency_code)
    const incoming = input.data ?? {}
    // ATM / CVS / BARCODE code issued: keep the trade, store the signed notice and the
    // instructions the storefront shows. This is NOT a payment.
    if (incoming.ecpay_payment_info && !incoming.ecpay_notice && !incoming.ecpay_trade_info) {
      const session = this.readSession(incoming)
      if (session.amount !== amount) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "an issued ECPay payment code cannot be re-priced")
      }
      const info = verifiedPaymentInfoFor(session.ecpay_payment_info, this.binding(session), this.credentials)
      if (!info) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPay payment code notice does not verify for this session")
      }
      return { data: { ...this.providerKeys(session), ecpay_payment_instructions: instructionsFrom(info) } }
    }
    if (incoming.ecpay_notice || incoming.ecpay_trade_info) {
      const session = this.readSession(incoming)
      if (session.amount !== amount) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "a paid ECPay trade cannot be re-priced")
      }
      if (!this.proofOfPayment(session)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPay payment proof does not verify for this session")
      }
      return { data: this.providerKeys(session) }
    }
    const data = this.buildSession(sessionId, amount, this.choosePayment(incoming))
    return { data: { ...clearedProofKeys(), ...data }, status: PaymentSessionStatus.PENDING }
  }

  // No network call: called at cart completion (before the shopper has paid) and from
  // processPaymentWorkflow after the ReturnURL route attached a verified notice.
  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const session = this.providerKeys(this.readSession(input.data))
    const proof = this.proofOfPayment(session)
    if (!proof) {
      return { status: PaymentSessionStatus.PENDING_AUTHORIZATION, data: session }
    }
    return {
      status: PaymentSessionStatus.CAPTURED,
      data: { ...session, ecpay_trade_no: proof.tradeNo, ecpay_payment_type: proof.paymentType },
    }
  }

  // AIO credit card trades settle automatically, so there is nothing to call at ECPay.
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: input.data }
  }

  // ECPay's refund API (CreditDetail/DoAction) exists only in production and cannot be
  // tested in stage. Until it is implemented and verified with a real transaction
  // (DEV_PLAN P4-08), a refund issued in Medusa (Super Admin only, RBAC) is recorded as
  // "manual_pending" and must be executed in the ECPay vendor back office the same day
  // (docs/ops/ecpay-manual-refund.md). The alert line is the hand-off to finance.
  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const amount = MathBN.convert(input.amount)
    if (!amount.isInteger() || amount.lte(0)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `refund must be a positive whole TWD amount, got ${amount.toString()}`)
    }
    const data = (input.data ?? {}) as Record<string, unknown>
    const previous = Array.isArray(data.ecpay_manual_refunds) ? data.ecpay_manual_refunds : []
    const record = {
      amount: amount.toNumber(),
      status: "manual_pending",
      requested_at: new Date().toISOString(),
    }
    this.logger_.error(
      `[ECPAY-ALERT] manual refund required: NT$${record.amount} for MerchantTradeNo ${String(data.merchant_trade_no)} / TradeNo ${String(data.ecpay_trade_no)}`
    )
    return { data: { ...data, ecpay_manual_refunds: [...previous, record] } }
  }

  // Unpaid ECPay trades simply expire; paid ones must be refunded, not cancelled here.
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  // Proof first (no network); otherwise ask ECPay (used by reconciliation, P4-10).
  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const session = this.readSession(input.data)
    if (this.proofOfPayment(session)) {
      return { status: PaymentSessionStatus.CAPTURED, data: input.data }
    }
    const info = await this.queryTradeInfo(session.merchant_trade_no)
    return { status: this.statusFrom(info, session), data: input.data }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const session = this.readSession(input.data)
    const info = await this.queryTradeInfo(session.merchant_trade_no)
    return {
      data: info
        ? { ...session, ecpay_trade_no: info.tradeNo, ecpay_payment_type: info.paymentType }
        : { ...session },
    }
  }

  // Maps a ReturnURL notice to a Medusa action. The route verifies the signature first;
  // this re-verifies so the provider never acts on an unsigned body.
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const notice = parsePaymentNotice(payload.data ?? {}, this.credentials)
    const none = { session_id: "", amount: new BigNumber(0) }
    if (!notice) {
      return { action: PaymentActions.FAILED, data: none }
    }
    const data = { session_id: notice.sessionId, amount: new BigNumber(notice.tradeAmt) }
    if (notice.simulatePaid && !this.options_.acceptSimulatedPayments) {
      return { action: PaymentActions.NOT_SUPPORTED, data }
    }
    if (notice.rtnCode !== "1") {
      return { action: PaymentActions.FAILED, data }
    }
    return { action: PaymentActions.SUCCESSFUL, data }
  }
}

export default EcpayPaymentProviderService
