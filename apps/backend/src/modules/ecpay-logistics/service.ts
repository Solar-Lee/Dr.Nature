// ECPay logistics fulfillment provider (P4-05): convenience-store pickup (C2C 店到店 by
// default) and TCAT home delivery. Verified against Medusa 2.21.2 source and real ECPay stage
// (docs/research/ecpay-logistics-stage-probe-2026-10-13.md).
//
//  - validateFulfillmentData: the shopper's `data` reaches it unchecked and ONLY its return
//    value is stored (shipping_method.data). Build the result from an allow-list; re-check the
//    option too (Medusa never calls validateOption). The e-map store choice is unsigned.
//  - createFulfillment: creates the shipment at ECPay (Express/Create, MD5). Throwing makes
//    Medusa delete the fulfillment row WITHOUT calling cancelFulfillment, so when ECPay may
//    have created the shipment anyway (no or unusable answer) we first ask ECPay
//    (QueryLogisticsTradeInfo) and adopt it, else raise [ECPAY-ALERT] with the trade number.
//    The returned data/labels are stored on the fulfillment and may be visible to the
//    shopper: never put credentials there.
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
  buildQueryLogisticsTradeInfoRequest,
  nameProblem,
  newLogisticsTradeNo,
  normalizeCellphone,
  parseChosenStore,
  parseCreateShipmentResponse,
  parseLogisticsTradeInfo,
  receiverName,
  receiverProblem,
  shipmentCode,
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
// ECPay GoodsAmount range for pickup without collection (developers.ecpay.com.tw/8809/).
const MAX_DECLARED_TWD = 20_000

const str = (v: unknown) => (typeof v === "string" ? v : "")

type OrderLine = {
  id: string
  total?: unknown
  quantity?: unknown
  detail?: { quantity?: unknown }
  variant?: { inventory_items?: { required_quantity?: unknown; inventory?: { id?: string } }[] }
}

// Declared value of THIS shipment: the paid (tax-inclusive, after-discount) price of the
// fulfilled quantities. Fulfillment items are one per line, or one per inventory item of a
// managed variant with quantity x required_quantity (Medusa 2.21.2 create-fulfillment).
export function declaredValue(
  items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
  orderItems: OrderLine[]
): number {
  const lines = new Map(orderItems.map((l) => [l.id, l]))
  const fulfilled = new Map<string, number>()
  for (const it of items) {
    const line = lines.get(str(it.line_item_id))
    if (!line) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `fulfillment item ${it.line_item_id} is not on the order`)
    }
    const perUnit = line.variant?.inventory_items?.find((ii) => ii.inventory?.id === it.inventory_item_id)?.required_quantity
    const units = MathBN.convert(it.quantity as never).toNumber() / Number(perUnit ?? 1)
    fulfilled.set(line.id, Math.max(fulfilled.get(line.id) ?? 0, units))
  }
  let total = MathBN.convert(0)
  for (const [id, units] of fulfilled) {
    const line = lines.get(id)!
    const lineQty = Number(line.quantity ?? line.detail?.quantity)
    if (line.total === undefined || line.total === null || !(lineQty > 0)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `order line ${id} has no total/quantity to declare`)
    }
    total = MathBN.add(total, MathBN.mult(MathBN.div(line.total as never, lineQty), units))
  }
  return Math.round(total.toNumber())
}

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
    const problem = receiverProblem(context?.shipping_address)
    if (problem) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, problem)
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
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const option = this.optionFor({ id: data.option_id, logistics_type: data.logistics_type, logistics_subtype: data.logistics_subtype })
    // Staff may override the recipient when fulfilling; Medusa passes the merged address here.
    const address = fulfillment?.delivery_address ?? order?.shipping_address
    if (!order || !address) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "ECPay logistics needs the order's shipping address")
    }
    const declared = declaredValue(items, ((order as { items?: OrderLine[] }).items ?? []) as OrderLine[])
    if (declared > MAX_DECLARED_TWD) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `此次出貨申報金額 NT$${declared} 超過超商取貨上限 NT$${MAX_DECLARED_TWD}，請分成多筆出貨`
      )
    }
    const merchantTradeNo = newLogisticsTradeNo(new Date(), crypto.randomBytes(6))
    const orderCreated = (order as { created_at?: string | Date }).created_at
    const common = {
      credentials: this.credentials,
      merchantTradeNo,
      // ECPay asks for the time of the shopper's purchase (developers.ecpay.com.tw/8809/).
      tradeDate: orderCreated ? new Date(orderCreated) : new Date(),
      // A free shipment (100% discount, gift) still needs a declared value of 1-20000.
      goodsAmount: Math.max(1, declared),
      goodsName: GOODS_NAME,
      sender: { name: this.options_.sender.name, cellphone: this.options_.sender.cellphone },
      receiver: {
        name: receiverName(address),
        cellphone: str(address.phone),
        email: str((order as { customer?: { email?: unknown } }).customer?.email),
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

    let f: Record<string, string>
    let body: string | null = null
    let failure: string | null = null
    try {
      const res = await fetch(`${this.options_.apiHost}/Express/Create`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(request),
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      })
      body = await res.text()
    } catch (e) {
      failure = `no answer (${(e as Error).message})`
    }
    const result = body === null ? null : parseCreateShipmentResponse(body, this.credentials, merchantTradeNo)
    if (result?.ok) {
      f = result.fields
    } else if (result && !result.uncertain) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `ECPay refused the shipment: ${result.message}`)
    } else {
      // ECPay may have created it: adopt it if ECPay confirms, otherwise make staff check.
      failure = failure ?? (result as { message: string }).message
      const found = await this.findShipment(merchantTradeNo)
      if (!found) {
        this.logger_.error(
          `[ECPAY-ALERT] ${merchantTradeNo}: Express/Create outcome unknown (${failure}); check the ECPay back office before fulfilling again`
        )
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `ECPay logistics: ${failure}. Check MerchantTradeNo ${merchantTradeNo} in the ECPay back office before retrying`
        )
      }
      this.logger_.warn(`[ecpay-logistics] ${merchantTradeNo}: ${failure}; ECPay confirms shipment ${found.AllPayLogisticsID}`)
      f = { ...found, RtnCode: found.LogisticsStatus ?? "", RtnMsg: "" }
    }
    this.logger_.info(`[ecpay-logistics] ${merchantTradeNo}: shipment ${f.AllPayLogisticsID} created for ${items.length} item(s)`)
    return {
      data: {
        option_id: option.id,
        logistics_type: option.logistics_type,
        logistics_subtype: option.logistics_subtype,
        ...(store ? { store } : {}),
        ecpay_merchant_trade_no: merchantTradeNo,
        ecpay_all_pay_logistics_id: f.AllPayLogisticsID,
        ecpay_declared_value: common.goodsAmount,
        ...(f.CVSPaymentNo ? { ecpay_cvs_payment_no: f.CVSPaymentNo } : {}),
        ...(f.CVSValidationNo ? { ecpay_cvs_validation_no: f.CVSValidationNo } : {}),
        ...(f.BookingNote ? { ecpay_booking_note: f.BookingNote } : {}),
        ecpay_status: { code: f.RtnCode ?? "", message: f.RtnMsg ?? "" },
      },
      labels: [{ tracking_number: shipmentCode(f), tracking_url: "", label_url: "" }],
    }
  }

  // Signed QueryLogisticsTradeInfo answer for our trade, or null (unknown trade answers
  // "0|找不到訂單"; network errors and bad signatures also count as "not confirmed").
  protected async findShipment(merchantTradeNo: string): Promise<Record<string, string> | null> {
    try {
      const res = await fetch(`${this.options_.apiHost}/Helper/QueryLogisticsTradeInfo/V5`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(buildQueryLogisticsTradeInfoRequest(this.credentials, merchantTradeNo, new Date())),
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      })
      return parseLogisticsTradeInfo(await res.text(), this.credentials, merchantTradeNo)
    } catch {
      return null
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
