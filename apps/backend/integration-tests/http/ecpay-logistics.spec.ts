// P4-05 acceptance: ECPay logistics (C2C convenience-store pickup) through the real store and
// admin APIs. ECPay's Express/Create is replaced by a local stub on ECPAY_LOGISTICS_API_BASE_URL
// that checks our MD5 signature and answers like real stage did (signed "1|..."; see
// docs/research/ecpay-logistics-stage-probe-2026-10-13.md). Status notices are signed with the
// PUBLIC C2C sandbox keys. Not provable here: ECPay calling our ServerReplyURL (needs a public
// URL, and stage never sends status notices).
//
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
import http from "http"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { computeCheckMacValue, verifyCheckMacValue } from "../../src/lib/ecpay/check-mac-value"
import { ECPAY_LOGISTICS_PROVIDER_ID, ECPAY_PROVIDER_ID } from "../../src/lib/ecpay/config"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import catalog from "../../src/data/catalog.json"
import { makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"

jest.setTimeout(180 * 1000)

const LOG_MAC = {
  hashKey: process.env.ECPAY_LOGISTICS_HASH_KEY as string,
  hashIV: process.env.ECPAY_LOGISTICS_HASH_IV as string,
  algorithm: "md5" as const,
}
const LOG_MERCHANT = process.env.ECPAY_LOGISTICS_MERCHANT_ID as string
const STUB_URL = new URL(process.env.ECPAY_LOGISTICS_API_BASE_URL as string)

// The 7-ELEVEN store ECPay's stage map returns (2026-10-13).
const STAGE_711_STORE = {
  LogisticsSubType: "UNIMARTC2C",
  CVSStoreID: "238669",
  CVSStoreName: "經貿",
  CVSAddress: "台北市南港區三重路19號1樓",
  CVSOutSide: "0",
}

// ---- Express/Create stub ---------------------------------------------------------------
const createRequests: Record<string, string>[] = []
let nextCreateFails = false
let logisticsId = 3690131
const stub = http.createServer((req, res) => {
  let raw = ""
  req.on("data", (c) => (raw += c))
  req.on("end", () => {
    const params = Object.fromEntries(new URLSearchParams(raw))
    if (req.url !== "/Express/Create" || !verifyCheckMacValue(params, LOG_MAC)) {
      res.writeHead(200).end("0|CheckMacValue Error")
      return
    }
    createRequests.push(params)
    if (nextCreateFails) {
      nextCreateFails = false
      res.writeHead(200).end("0|ReceiverStoreID錯誤")
      return
    }
    const fields = {
      AllPayLogisticsID: String(logisticsId++),
      BookingNote: "",
      CVSPaymentNo: "D8844527",
      CVSValidationNo: params.LogisticsSubType === "UNIMARTC2C" ? "4471" : "",
      GoodsAmount: params.GoodsAmount,
      LogisticsSubType: params.LogisticsSubType,
      LogisticsType: params.LogisticsType,
      MerchantID: LOG_MERCHANT,
      MerchantTradeNo: params.MerchantTradeNo,
      ReceiverName: params.ReceiverName,
      RtnCode: "300",
      RtnMsg: "訂單處理中(綠界已收到訂單資料)",
      UpdateStatusDate: "2026/10/13 03:00:00",
    }
    res.writeHead(200, { "content-type": "text/html" })
    res.end(`1|${new URLSearchParams({ ...fields, CheckMacValue: computeCheckMacValue(fields, LOG_MAC) }).toString()}`)
  })
})

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    beforeAll(async () => {
      await new Promise<void>((resolve) => stub.listen(Number(STUB_URL.port), STUB_URL.hostname, resolve))
      const container = getContainer()
      await runAllSeeds(container)
      await devAddTestStock({ container, args: [] } as any)
    })
    afterAll(async () => {
      await new Promise<void>((resolve) => stub.close(() => resolve()))
    })
    beforeEach(() => {
      createRequests.length = 0
      nextCreateFails = false
    })

    const { storeHeaders, superAdminHeaders } = makeCheckoutHelpers({ api, getContainer })

    const cartWithItem = async (name = { first_name: "小華", last_name: "陳" }) => {
      const headers = await storeHeaders()
      const { data: r } = await api.get("/store/regions", { headers })
      const { data: p } = await api.get(`/store/products?handle=${catalog.products[0].handle}&fields=*variants`, { headers })
      const { data: c } = await api.post(
        "/store/carts",
        {
          region_id: r.regions[0].id,
          email: "buyer@drn.test",
          shipping_address: { ...name, address_1: "信義路五段7號", city: "台北市", postal_code: "110", country_code: "tw", phone: "0987-654-321" },
        },
        { headers }
      )
      await api.post(`/store/carts/${c.cart.id}/line-items`, { variant_id: p.products[0].variants[0].id, quantity: 1 }, { headers })
      const { data: so } = await api.get(`/store/shipping-options?cart_id=${c.cart.id}`, { headers })
      return { headers, cartId: c.cart.id, options: so.shipping_options as any[] }
    }

    const optionId = (options: any[], code: string) => options.find((o) => o.data?.id === code)?.id

    const placeCvsOrder = async () => {
      const { headers, cartId, options } = await cartWithItem()
      await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: optionId(options, "cvs-unimart"), data: { store: STAGE_711_STORE } }, { headers })
      const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, { headers })
      await api.post(`/store/payment-collections/${pc.payment_collection.id}/payment-sessions`, { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } }, { headers })
      const { data: done } = await api.post(`/store/carts/${cartId}/complete`, {}, { headers })
      expect(done.type).toEqual("order")
      return done.order
    }

    const fulfill = async (order: any) => {
      const admin = await superAdminHeaders(`ops-${order.id}@drn.test`)
      const { data } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "order", fields: ["items.*"], filters: { id: order.id } })
      const items = (data[0].items ?? []).map((i: any) => ({ id: i.id, quantity: Number(i.quantity ?? i.detail?.quantity) }))
      expect(items.every((i: any) => i.quantity > 0)).toBe(true)
      return api.post(
        `/admin/orders/${order.id}/fulfillments`,
        { items },
        { headers: admin, validateStatus: () => true }
      )
    }

    const fulfillmentOf = async (orderId: string) => {
      const { data } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({
          entity: "order",
          fields: ["fulfillments.id", "fulfillments.data", "fulfillments.metadata", "fulfillments.shipped_at", "fulfillments.delivered_at", "fulfillments.labels.tracking_number"],
          filters: { id: orderId },
        })
      return data[0].fulfillments?.[0] as any
    }

    const notice = (f: any, rtnCode: string, rtnMsg: string, extra: Record<string, string> = {}) => {
      const fields = {
        MerchantID: LOG_MERCHANT,
        MerchantTradeNo: f.data.ecpay_merchant_trade_no,
        RtnCode: rtnCode,
        RtnMsg: rtnMsg,
        AllPayLogisticsID: f.data.ecpay_all_pay_logistics_id,
        LogisticsType: "CVS",
        LogisticsSubType: "UNIMARTC2C",
        GoodsAmount: "1150",
        UpdateStatusDate: "2026/10/15 18:30:00",
        CVSPaymentNo: "D8844527",
        CVSValidationNo: "4471",
        ...extra,
      }
      return { ...fields, CheckMacValue: computeCheckMacValue(fields, LOG_MAC) }
    }
    const postStatus = (body: Record<string, string>) =>
      api.post("/hooks/ecpay/logistics", new URLSearchParams(body).toString(), {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        validateStatus: () => true,
      })

    it("offers 7-ELEVEN / 全家 / 萊爾富 pickup for free; home delivery is not enabled yet", async () => {
      const { options } = await cartWithItem()
      const ecpay = options.filter((o) => o.provider_id === ECPAY_LOGISTICS_PROVIDER_ID)
      expect(ecpay.map((o) => o.data.id).sort()).toEqual(["cvs-fami", "cvs-hilife", "cvs-unimart"])
      for (const o of ecpay) {
        expect(Number(o.amount)).toEqual(0)
      }
    })

    it("map-form returns the stage e-map form for an option, without credentials", async () => {
      const headers = await storeHeaders()
      const { data } = await api.get("/store/ecpay/logistics/map-form?option=cvs-fami&mobile=1", { headers })
      expect(data.form.action).toEqual("https://logistics-stage.ecpay.com.tw/Express/map")
      expect(data.form.fields).toMatchObject({ MerchantID: LOG_MERCHANT, LogisticsSubType: "FAMIC2C", Device: "1", ExtraData: "cvs-fami" })
      expect(JSON.stringify(data)).not.toContain(LOG_MAC.hashKey)
      const bad = await api.get("/store/ecpay/logistics/map-form?option=home-tcat", { headers, validateStatus: () => true })
      expect(bad.status).toEqual(400)
    })

    it("stores only the allow-listed store fields on the shipping method", async () => {
      const { headers, cartId, options } = await cartWithItem()
      const { data } = await api.post(
        `/store/carts/${cartId}/shipping-methods?fields=*shipping_methods`,
        { option_id: optionId(options, "cvs-unimart"), data: { store: STAGE_711_STORE, evil: "x", price: 0 } },
        { headers }
      )
      const stored = data.cart.shipping_methods[0].data
      expect(stored).toEqual({
        option_id: "cvs-unimart",
        logistics_type: "CVS",
        logistics_subtype: "UNIMARTC2C",
        store: { subtype: "UNIMARTC2C", store_id: "238669", store_name: "經貿", store_address: "台北市南港區三重路19號1樓", outlying_island: false },
      })
    })

    it.each([
      ["no store", {}],
      ["a FamilyMart store on the 7-ELEVEN option", { store: { ...STAGE_711_STORE, LogisticsSubType: "FAMIC2C" } }],
      ["a malformed store id", { store: { ...STAGE_711_STORE, CVSStoreID: "<script>" } }],
    ])("refuses a pickup option with %s", async (_n, data) => {
      const { headers, cartId, options } = await cartWithItem()
      const res = await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: optionId(options, "cvs-unimart"), data }, { headers, validateStatus: () => true })
      expect(res.status).toEqual(400)
    })

    it("refuses a receiver name ECPay would reject, before checkout", async () => {
      const { headers, cartId, options } = await cartWithItem({ first_name: "User1", last_name: "Test" })
      const res = await api.post(
        `/store/carts/${cartId}/shipping-methods`,
        { option_id: optionId(options, "cvs-unimart"), data: { store: STAGE_711_STORE } },
        { headers, validateStatus: () => true }
      )
      expect(res.status).toEqual(400)
    })

    it("admin fulfillment creates a signed ECPay shipment and stores its codes", async () => {
      const order = await placeCvsOrder()
      const res = await fulfill(order)
      expect({ status: res.status, body: res.status === 200 ? null : res.data }).toEqual({ status: 200, body: null })
      expect(createRequests).toHaveLength(1)
      expect(createRequests[0]).toMatchObject({
        MerchantID: LOG_MERCHANT,
        LogisticsType: "CVS",
        LogisticsSubType: "UNIMARTC2C",
        ReceiverStoreID: "238669",
        GoodsAmount: String(catalog.products[0].price),
        IsCollection: "N",
        SenderName: "王小明",
        ReceiverName: "陳小華",
        ReceiverCellPhone: "0987654321",
        ServerReplyURL: "http://localhost:9000/hooks/ecpay/logistics",
      })
      const f = await fulfillmentOf(order.id)
      expect(f.data).toMatchObject({
        ecpay_all_pay_logistics_id: expect.any(String),
        ecpay_cvs_payment_no: "D8844527",
        ecpay_cvs_validation_no: "4471",
        ecpay_merchant_trade_no: createRequests[0].MerchantTradeNo,
      })
      expect(f.labels[0].tracking_number).toEqual("D8844527-4471")
      expect(JSON.stringify(f.data)).not.toContain(LOG_MAC.hashKey)
    })

    it("an ECPay refusal fails the fulfillment and leaves none behind", async () => {
      const order = await placeCvsOrder()
      nextCreateFails = true
      const res = await fulfill(order)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(JSON.stringify(res.data)).toContain("ECPay refused the shipment")
      expect(createRequests).toHaveLength(1) // ECPay was really asked
      expect(await fulfillmentOf(order.id)).toBeUndefined()
    })

    it("status notices: shipped -> arrived -> picked up, each acknowledged once-only", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      let f = await fulfillmentOf(order.id)

      expect((await postStatus(notice(f, "2068", "賣家已到門市寄件"))).data).toEqual("1|OK")
      f = await fulfillmentOf(order.id)
      expect(f.shipped_at).toBeTruthy()
      expect(f.delivered_at).toBeFalsy()
      expect((await postStatus(notice(f, "2068", "賣家已到門市寄件"))).data).toEqual("1|OK") // duplicate

      expect((await postStatus(notice(f, "2073", "包裹配達取件門市"))).data).toEqual("1|OK")
      f = await fulfillmentOf(order.id)
      expect(f.metadata.ecpay_status.code).toEqual("2073")
      expect(f.delivered_at).toBeFalsy()

      expect((await postStatus(notice(f, "2067", "買家已到店取貨"))).data).toEqual("1|OK")
      f = await fulfillmentOf(order.id)
      expect(f.delivered_at).toBeTruthy()
      expect((await postStatus(notice(f, "2067", "買家已到店取貨"))).data).toEqual("1|OK") // duplicate
      expect(f.metadata.ecpay_status_history.map((s: any) => s.code)).toEqual(["2068", "2068", "2073", "2067"])
    })

    it("picked-up notice without a prior shipped notice still ships, then delivers", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      expect((await postStatus(notice(f, "2067", "買家已到店取貨"))).data).toEqual("1|OK")
      const after = await fulfillmentOf(order.id)
      expect(after.shipped_at).toBeTruthy()
      expect(after.delivered_at).toBeTruthy()
    })

    it("not-picked-up notice is recorded and acknowledged without changing state", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      expect((await postStatus(notice(f, "2074", "買家未取包裹，將退回物流中心"))).data).toEqual("1|OK")
      const after = await fulfillmentOf(order.id)
      expect(after.metadata.ecpay_status.meaning).toEqual("returning")
      expect(after.delivered_at).toBeFalsy()
    })

    it.each([
      ["tampered", (f: any) => ({ ...notice(f, "2067", "買家已到店取貨"), RtnCode: "2074" })],
      ["unknown trade", (f: any) => notice({ data: { ...f.data, ecpay_merchant_trade_no: "DL0000000000000000XX" } }, "2067", "x")],
      ["other shipment id", (f: any) => notice({ data: { ...f.data, ecpay_all_pay_logistics_id: "1" } }, "2067", "x")],
    ])("%s notice -> 400, no state change", async (_n, make) => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      const res = await postStatus(make(f))
      expect(res.status).toEqual(400)
      expect((await fulfillmentOf(order.id)).delivered_at).toBeFalsy()
    })
  },
})
