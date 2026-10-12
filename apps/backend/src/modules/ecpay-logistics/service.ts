// ECPay logistics fulfillment provider (P4-05): convenience-store pickup (C2C 店到店 by
// default) and TCAT home delivery. Verified against Medusa 2.21.2 source and real ECPay stage
// (docs/research/ecpay-logistics-stage-probe-2026-10-13.md).
//
//  - validateFulfillmentData: the shopper's `data` reaches it unchecked and ONLY its return
//    value is stored (shipping_method.data). Build the result from an allow-list; re-check the
//    option too (Medusa never calls validateOption). The e-map store choice is unsigned.
//  - createFulfillment: creates the shipment at ECPay (Express/Create, MD5). Throwing makes
//    Medusa delete the fulfillment row. The returned data/labels are stored on the fulfillment
//    and may be visible to the shopper: never put credentials there.
//  - cancelFulfillment: also the compensation step of order fulfillment, so it must not throw.
//    ECPay voiding is done in the back office for now (alert).
import crypto from "crypto"
import { AbstractFulfillmentProviderService, MathBN, MedusaError } from "@medusajs/framework/utils"
import type {
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  Logger,
  ValidateFulfillmentDataContext,
} from "@medusajs/framework/types"
import {
  B2C_CVS_SUBTYPES,
  C2C_CVS_SUBTYPES,
  buildCreateShipmentRequest,
  nameProblem,
  newLogisticsTradeNo,
  normalizeCellphone,
  parseChosenStore,
  parseCreateShipmentResponse,
  type ChosenStore,
  type CvsSubtype,
} from "../../lib/ecpay/logistics"
import type { EcpayLogisticsOptions } from "../../lib/ecpay/config"

type InjectedDependencies = { logger: Logger }

export type EcpayFulfillmentOption = FulfillmentOption & {
  id: string
  name: string
  logistics_type: "CVS" | "HOME"
  logistics_subtype: CvsSubtype | "TCAT"
}

export type EcpayMethodData = {
  option_id: string
  logistics_type: "CVS" | "HOME"
  logistics_subtype: CvsSubtype | "TCAT"
  store?: ChosenStore
}

const CREATE_TIMEOUT_MS = 15_000
const GOODS_NAME = "Dr.Nature 保健食品"

const str = (v: unknown) => (typeof v === "string" ? v : "")

export function fulfillmentOptionsFor(contract: "C2C" | "B2C"): EcpayFulfillmentOption[] {
  const [unimart, fami, hilife] = (contract === "C2C" ? C2C_CVS_SUBTYPES : B2C_CVS_SUBTYPES) as readonly CvsSubtype[]
  return [
    { id: "cvs-unimart", name: "7-ELEVEN 超商取貨", logistics_type: "CVS", logistics_subtype: unimart },
    { id: "cvs-fami", name: "全家 超商取貨", logistics_type: "CVS", logistics_subtype: fami },
    { id: "cvs-hilife", name: "萊爾富 超商取貨", logistics_type: "CVS", logistics_subtype: hilife },
    { id: "home-tcat", name: "宅配（黑貓）", logistics_type: "HOME", logistics_subtype: "TCAT" },
  ]
}

class EcpayLogisticsProviderService extends AbstractFulfillmentProviderService {
  static identifier = "ecpay"

  protected logger_: Logger
  protected options_: EcpayLogisticsOptions

  static validateOptions(options: Record<string, unknown>): void {
    for (const key of ["environment", "merchantId", "hashKey", "hashIV", "contract", "statusReplyUrl", "mapReplyUrl", "apiHost"]) {
      if (typeof options?.[key] !== "string" || !options[key]) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `ECPay logistics option "${key}" is required`)
      }
    }
    const sender = options.sender as { name?: string; cellphone?: string } | undefined
    if (!sender || nameProblem(sender.name ?? "") || !normalizeCellphone(sender.cellphone ?? "")) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ECPay logistics sender needs a personal name (2-5 Chinese characters) and a 09xxxxxxxx cellphone"
      )
    }
    if (options.environment === "prod" && !String(options.statusReplyUrl).startsWith("https://")) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPay logistics ServerReplyURL must be HTTPS in prod")
    }
  }

  constructor(container: InjectedDependencies, options: EcpayLogisticsOptions) {
    super()
    this.logger_ = container.logger
    this.options_ = options
  }

  protected get credentials() {
    return { merchantId: this.options_.merchantId, hashKey: this.options_.hashKey, hashIV: this.options_.hashIV }
  }

  protected optionFor(optionData: Record<string, unknown>): EcpayFulfillmentOption {
    const option = fulfillmentOptionsFor(this.options_.contract).find(
      (o) =>
        o.id === optionData?.id &&
        o.logistics_type === optionData?.logistics_type &&
        o.logistics_subtype === optionData?.logistics_subtype
    )
    if (!option) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "unknown ECPay logistics option for this contract")
    }
    return option
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return fulfillmentOptionsFor(this.options_.contract)
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    this.optionFor(data)
    return true
  }

  // Runs when the shopper adds the shipping method. Its return value is what gets stored.
  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: ValidateFulfillmentDataContext
  ): Promise<EcpayMethodData> {
    const option = this.optionFor(optionData)
    const address = context?.shipping_address
    if (!address || str(address.country_code).toLowerCase() !== "tw") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "請先填寫台灣收件地址")
    }
    if (!normalizeCellphone(str(address.phone))) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "收件人手機須為 09 開頭的 10 碼號碼")
    }
    const receiverName = `${str(address.last_name)}${str(address.first_name)}`.trim()
    const problem = nameProblem(receiverName)
    if (problem) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "收件人姓名須為 2-5 個中文字或 4-10 個英文字母，不可含數字或符號")
    }
    if (option.logistics_type === "HOME") {
      return { option_id: option.id, logistics_type: "HOME", logistics_subtype: "TCAT" }
    }
    return {
      option_id: option.id,
      logistics_type: "CVS",
      logistics_subtype: option.logistics_subtype as CvsSubtype,
      store: parseChosenStore((data?.store as Record<string, unknown>) ?? data ?? {}, option.logistics_subtype as CvsSubtype),
    }
  }

  // Shipping is free for every option (全館免運, Aki 2026-10-13): flat prices only.
  async canCalculate(): Promise<boolean> {
    return false
  }

  async calculatePrice(): Promise<CalculatedShippingOptionPrice> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "ECPay logistics options use flat prices")
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const option = this.optionFor({ id: data.option_id, logistics_type: data.logistics_type, logistics_subtype: data.logistics_subtype })
    const address = order?.shipping_address
    if (!order || !address) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPay logistics needs the order's shipping address")
    }
    // Declared value for ECPay (1-20000 TWD): the order's goods total.
    const itemTotal = (order as { item_total?: number | string }).item_total ?? 0
    const goodsAmount = Math.round(MathBN.convert(itemTotal).toNumber())
    const merchantTradeNo = newLogisticsTradeNo(new Date(), crypto.randomBytes(6))
    const common = {
      credentials: this.credentials,
      merchantTradeNo,
      tradeDate: new Date(),
      goodsAmount,
      goodsName: GOODS_NAME,
      sender: { name: this.options_.sender.name, cellphone: this.options_.sender.cellphone },
      receiver: {
        name: `${str(address.last_name)}${str(address.first_name)}`.trim(),
        cellphone: str(address.phone),
        ...(str((order as { email?: unknown }).email) ? { email: str((order as { email?: unknown }).email) } : {}),
      },
      serverReplyUrl: this.options_.statusReplyUrl,
    }
    let request: Record<string, string>
    let store: ChosenStore | undefined
    if (option.logistics_type === "CVS") {
      store = parseChosenStore((data.store as Record<string, unknown>) ?? {}, option.logistics_subtype as CvsSubtype)
      request = buildCreateShipmentRequest({ ...common, type: "CVS", subtype: store.subtype, storeId: store.store_id })
    } else {
      const { zipCode, address: senderAddress } = this.options_.sender
      if (!zipCode || !senderAddress) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "home delivery needs ECPAY_LOGISTICS_SENDER_ZIPCODE/ADDRESS")
      }
      request = buildCreateShipmentRequest({
        ...common,
        type: "HOME",
        subtype: "TCAT",
        senderZip: zipCode,
        senderAddress,
        receiverZip: str(address.postal_code),
        receiverAddress: [str(address.city), str(address.address_1), str(address.address_2)].join(""),
      })
    }

    let body: string
    try {
      const res = await fetch(`${this.options_.apiHost}/Express/Create`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(request),
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      })
      body = await res.text()
    } catch (e) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `ECPay logistics unreachable: ${(e as Error).message}`)
    }
    const result = parseCreateShipmentResponse(body, this.credentials)
    if (!result.ok) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `ECPay refused the shipment: ${result.message}`)
    }
    const f = result.fields
    const trackingNumber = [f.CVSPaymentNo, f.CVSValidationNo].filter(Boolean).join("-") || f.BookingNote || f.AllPayLogisticsID
    this.logger_.info(`[ecpay-logistics] ${merchantTradeNo}: shipment ${f.AllPayLogisticsID} created for ${items.length} item(s)`)
    return {
      data: {
        option_id: option.id,
        logistics_type: option.logistics_type,
        logistics_subtype: option.logistics_subtype,
        ...(store ? { store } : {}),
        ecpay_merchant_trade_no: merchantTradeNo,
        ecpay_all_pay_logistics_id: f.AllPayLogisticsID ?? "",
        ...(f.CVSPaymentNo ? { ecpay_cvs_payment_no: f.CVSPaymentNo } : {}),
        ...(f.CVSValidationNo ? { ecpay_cvs_validation_no: f.CVSValidationNo } : {}),
        ...(f.BookingNote ? { ecpay_booking_note: f.BookingNote } : {}),
        ecpay_status: { code: f.RtnCode ?? "", message: f.RtnMsg ?? "" },
      },
      labels: [{ tracking_number: trackingNumber ?? "", tracking_url: "", label_url: "" }],
    }
  }

  // Must not throw (it is also the compensation of order fulfillment). Voiding an ECPay
  // shipment is done in the ECPay back office until the cancel APIs are verified.
  async cancelFulfillment(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (str(data?.ecpay_all_pay_logistics_id)) {
      this.logger_.error(
        `[ECPAY-ALERT] void ECPay shipment ${str(data.ecpay_all_pay_logistics_id)} (${str(data.ecpay_merchant_trade_no)}) in the ECPay back office`
      )
    }
    return {}
  }

  // C2C 店到店 has no reverse logistics (docs/research/ecpay.md LOG-16).
  async createReturnFulfillment(): Promise<CreateFulfillmentResult> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "ECPay C2C has no return shipments; arrange returns manually")
  }
}

export default EcpayLogisticsProviderService
