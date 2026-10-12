// ECPay AIO payment provider (P4-03): credit card and Apple Pay.
//
// Flow ("order first, then pay", the usual Taiwan checkout):
//  1. Storefront creates a payment session (provider pp_ecpay_ecpay, data.choose_payment).
//     initiatePayment signs the ECPay checkout form and returns it in session.data.
//  2. Storefront completes the cart. authorizePayment asks ECPay (QueryTradeInfo); the trade
//     is not paid yet, so it returns pending_authorization and Medusa creates the order
//     without a payment.
//  3. Browser POSTs the form to ECPay; the shopper pays.
//  4. ECPay POSTs the signed ReturnURL notice to /hooks/ecpay/payment. The route verifies it
//     and runs processPaymentWorkflow, which calls authorizePayment again; QueryTradeInfo now
//     reports TradeStatus=1, so the payment is recorded as captured (AIO settles itself).
//
// Trust: payment_session.data is readable by shoppers and partly writable by them at
// creation, so this provider never decides "paid" from session.data. Only a QueryTradeInfo
// response with a valid CheckMacValue and the expected amount counts as paid.
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
  type ChoosePayment,
  type CheckoutForm,
  type MerchantCredentials,
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
}

const QUERY_TIMEOUT_MS = 10_000

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
    ]) {
      if (typeof options?.[key] !== "string" || !options[key]) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `ECPay option "${key}" is required`)
      }
    }
    if (options.environment === "prod" && !String(options.returnUrl).startsWith("https://")) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPay ReturnURL must be HTTPS in prod")
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
    return { id: data.merchant_trade_no, data, status: PaymentSessionStatus.PENDING }
  }

  // The module replaces session.data with what this returns. A changed amount needs a new
  // MerchantTradeNo because ECPay never re-prices an issued trade number.
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const sessionId = input.data?.session_id
    if (typeof sessionId !== "string") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "session_id missing")
    }
    const amount = this.toWholeTwd(input.amount, input.currency_code)
    const data = this.buildSession(sessionId, amount, this.choosePayment(input.data))
    return { data, status: PaymentSessionStatus.PENDING }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const session = this.readSession(input.data)
    const info = await this.queryTradeInfo(session.merchant_trade_no)
    const status = this.statusFrom(info, session)
    return {
      status,
      data:
        status === PaymentSessionStatus.CAPTURED && info
          ? { ...session, ecpay_trade_no: info.tradeNo, ecpay_payment_type: info.paymentType }
          : { ...session },
    }
  }

  // AIO credit card trades settle automatically, so there is nothing to call at ECPay.
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: input.data }
  }

  // ECPay's refund API (CreditDetail/DoAction) exists only in production and cannot be
  // tested in stage. Until it is implemented and verified with a real transaction
  // (DEV_PLAN P4-08), refunds are made in the ECPay vendor back office.
  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const amount = MathBN.convert(input.amount).toString()
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `ECPay refunds (NT$${amount}) are not automated yet: refund in the ECPay vendor back office (P4-08)`
    )
  }

  // Unpaid ECPay trades simply expire; paid ones must be refunded, not cancelled here.
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const session = this.readSession(input.data)
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
    if (notice.simulatePaid) {
      return { action: PaymentActions.NOT_SUPPORTED, data }
    }
    if (notice.rtnCode !== "1") {
      return { action: PaymentActions.FAILED, data }
    }
    return { action: PaymentActions.SUCCESSFUL, data }
  }
}

export default EcpayPaymentProviderService
