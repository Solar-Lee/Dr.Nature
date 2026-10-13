// P4-05 acceptance: ECPay logistics (C2C convenience-store pickup) through the real store and
// admin APIs. ECPay's Express/Create and QueryLogisticsTradeInfo are replaced by a local stub on
// ECPAY_LOGISTICS_API_BASE_URL that checks our MD5 signature and answers like real stage did
// (signed "1|..." / signed "k=v", "0|找不到訂單" for unknown trades; see
// docs/research/ecpay-logistics-stage-probe-2026-10-13.md). Status notices are signed with the
// PUBLIC C2C sandbox keys. Not provable here: ECPay calling our ServerReplyURL (needs a public
// URL, and stage never sends status notices).
//
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
import http from "http"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { formatTaipeiDate } from "../../src/lib/ecpay/aio"
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

// ---- Express/Create + QueryLogisticsTradeInfo stub ---------------------------------------
const createRequests: Record<string, string>[] = []
const trades = new Map<string, Record<string, string>>()
// ok: signed success | refuse: "0|..." | drop: shipment created, connection dropped before the
// answer | lost: connection dropped and nothing created
let createMode: "ok" | "refuse" | "drop" | "lost" = "ok"
// P4-11: UpdateStoreInfo / CancelC2COrder calls, answered "1|OK" unless afterSaleRefuse is set.
const afterSaleRequests: { path: string; params: Record<string, string> }[] = []
let afterSaleRefuse = ""
// When set, UpdateStoreInfo / CancelC2COrder answer with this HTTP status and an HTML page
// (a lost or garbled answer: ECPay may or may not have applied the change).
let afterSaleGarbled = 0
let logisticsId = 3690131
const signed = (f: Record<string, string>) => new URLSearchParams({ ...f, CheckMacValue: computeCheckMacValue(f, LOG_MAC) }).toString()
const stub = http.createServer((req, res) => {
  let raw = ""
  req.on("data", (c) => (raw += c))
  req.on("end", () => {
    const params = Object.fromEntries(new URLSearchParams(raw))
    if (!verifyCheckMacValue(params, LOG_MAC)) {
      res.writeHead(200).end("0|CheckMacValue Error")
      return
    }
    if (req.url === "/Helper/QueryLogisticsTradeInfo/V5") {
      const t = trades.get(params.MerchantTradeNo)
      if (!t) {
        res.writeHead(500, { "content-type": "text/html" }).end("0|找不到訂單")
        return
      }
      const { RtnCode, RtnMsg, ...rest } = t
      res.writeHead(200, { "content-type": "text/html" }).end(signed({ ...rest, LogisticsStatus: RtnCode }))
      return
    }
    if (req.url === "/Express/UpdateStoreInfo" || req.url === "/Express/CancelC2COrder") {
      afterSaleRequests.push({ path: String(req.url), params })
      if (afterSaleGarbled) {
        res.writeHead(afterSaleGarbled, { "content-type": "text/html" }).end("<html><body>Bad Gateway</body></html>")
        return
      }
      res.writeHead(200, { "content-type": "text/html" }).end(afterSaleRefuse ? `0|${afterSaleRefuse}` : "1|OK")
      return
    }
    if (req.url !== "/Express/Create") {
      res.writeHead(404).end()
      return
    }
    createRequests.push(params)
    if (createMode === "refuse") {
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
    if (createMode !== "lost") {
      trades.set(params.MerchantTradeNo, fields)
    }
    if (createMode === "drop" || createMode === "lost") {
      req.socket.destroy()
      return
    }
    res.writeHead(200, { "content-type": "text/html" })
    res.end(`1|${signed(fields)}`)
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
      createMode = "ok"
      afterSaleRequests.length = 0
      afterSaleRefuse = ""
      afterSaleGarbled = 0
    })

    const { storeHeaders, superAdminHeaders } = makeCheckoutHelpers({ api, getContainer })

    const cartWithItem = async (name = { first_name: "小華", last_name: "陳" }, quantity = 1) => {
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
      await api.post(`/store/carts/${c.cart.id}/line-items`, { variant_id: p.products[0].variants[0].id, quantity }, { headers })
      const { data: so } = await api.get(`/store/shipping-options?cart_id=${c.cart.id}`, { headers })
      return { headers, cartId: c.cart.id, options: so.shipping_options as any[] }
    }

    const optionId = (options: any[], code: string) => options.find((o) => o.data?.id === code)?.id

    const placeCvsOrder = async (quantity = 1) => {
      const { headers, cartId, options } = await cartWithItem(undefined, quantity)
      await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: optionId(options, "cvs-unimart"), data: { store: STAGE_711_STORE } }, { headers })
      const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, { headers })
      await api.post(`/store/payment-collections/${pc.payment_collection.id}/payment-sessions`, { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } }, { headers })
      const { data: done } = await api.post(`/store/carts/${cartId}/complete`, {}, { headers })
      expect(done.type).toEqual("order")
      return done.order
    }

    const orderLines = async (orderId: string) => {
      const { data } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "order", fields: ["created_at", "items.*", "items.detail.*"], filters: { id: orderId } })
      return data[0] as any
    }

    const fulfill = async (order: any, opts: { quantity?: number; body?: Record<string, unknown> } = {}) => {
      const admin = await superAdminHeaders(`ops-${order.id}-${Math.random()}@drn.test`)
      const o = await orderLines(order.id)
      const items = (o.items ?? []).map((i: any) => ({ id: i.id, quantity: opts.quantity ?? Number(i.quantity ?? i.detail?.quantity) }))
      expect(items.every((i: any) => i.quantity > 0)).toBe(true)
      return api.post(
        `/admin/orders/${order.id}/fulfillments`,
        { items, ...opts.body },
        { headers: admin, validateStatus: () => true }
      )
    }

    const ecpayFulfillments = () =>
      getContainer().resolve(Modules.FULFILLMENT).listFulfillments({ provider_id: ECPAY_LOGISTICS_PROVIDER_ID }, { select: ["id"] })

    const fulfillmentOf = async (orderId: string) => {
      const { data } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({
          entity: "order",
          fields: ["fulfillments.id", "fulfillments.data", "fulfillments.metadata", "fulfillments.shipped_at", "fulfillments.delivered_at", "fulfillments.canceled_at", "fulfillments.labels.tracking_number"],
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

    it("refuses checkout when the address changed to one ECPay would reject", async () => {
      const { headers, cartId, options } = await cartWithItem()
      await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: optionId(options, "cvs-unimart"), data: { store: STAGE_711_STORE } }, { headers })
      await api.post(`/store/carts/${cartId}`, { shipping_address: { first_name: "小華", last_name: "陳", address_1: "信義路五段7號", city: "台北市", postal_code: "110", country_code: "tw", phone: "02-2345-6789" } }, { headers })
      const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, { headers })
      await api.post(`/store/payment-collections/${pc.payment_collection.id}/payment-sessions`, { provider_id: ECPAY_PROVIDER_ID, data: { choose_payment: "Credit" } }, { headers })
      const res = await api.post(`/store/carts/${cartId}/complete`, {}, { headers, validateStatus: () => true })
      expect(res.status).toEqual(400)
      expect(JSON.stringify(res.data)).toContain("收件人手機")
    })

    it("admin fulfillment creates a signed ECPay shipment and stores its codes", async () => {
      const order = await placeCvsOrder(2)
      const res = await fulfill(order)
      expect({ status: res.status, body: res.status === 200 ? null : res.data }).toEqual({ status: 200, body: null })
      expect(createRequests).toHaveLength(1)
      const o = await orderLines(order.id)
      expect(createRequests[0]).toMatchObject({
        MerchantID: LOG_MERCHANT,
        MerchantTradeDate: formatTaipeiDate(new Date(o.created_at)),
        LogisticsType: "CVS",
        LogisticsSubType: "UNIMARTC2C",
        ReceiverStoreID: "238669",
        GoodsAmount: String(2 * catalog.products[0].price),
        IsCollection: "N",
        SenderName: "王小明",
        ReceiverName: "陳小華",
        ReceiverCellPhone: "0987654321",
        ReceiverEmail: "buyer@drn.test",
        ServerReplyURL: "http://localhost:9000/hooks/ecpay/logistics",
      })
      const f = await fulfillmentOf(order.id)
      expect(f.data).toMatchObject({
        ecpay_all_pay_logistics_id: expect.any(String),
        ecpay_cvs_payment_no: "D8844527",
        ecpay_cvs_validation_no: "4471",
        ecpay_merchant_trade_no: createRequests[0].MerchantTradeNo,
        ecpay_declared_value: 2 * catalog.products[0].price,
      })
      // 7-ELEVEN C2C 交貨便代碼 = CVSPaymentNo + CVSValidationNo.
      expect(f.labels[0].tracking_number).toEqual("D88445274471")
      expect(JSON.stringify(f.data)).not.toContain(LOG_MAC.hashKey)
    })

    it("a partial shipment declares only its own items; staff can override the receiver", async () => {
      const order = await placeCvsOrder(2)
      const res = await fulfill(order, {
        quantity: 1,
        body: { delivery_address: { first_name: "大同", last_name: "林", phone: "0911222333" } },
      })
      expect({ status: res.status, body: res.status === 200 ? null : res.data }).toEqual({ status: 200, body: null })
      expect(createRequests[0]).toMatchObject({
        GoodsAmount: String(catalog.products[0].price),
        ReceiverName: "林大同",
        ReceiverCellPhone: "0911222333",
      })
    })

    it("an ECPay refusal fails the fulfillment and leaves none behind", async () => {
      const order = await placeCvsOrder()
      const before = (await ecpayFulfillments()).length
      createMode = "refuse"
      const res = await fulfill(order)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(JSON.stringify(res.data)).toContain("ECPay refused the shipment")
      expect(createRequests).toHaveLength(1) // ECPay was really asked
      expect((await ecpayFulfillments()).length).toEqual(before)
      expect(await fulfillmentOf(order.id)).toBeUndefined()
    })

    it("no answer, but ECPay created the shipment: it is adopted, not duplicated", async () => {
      const order = await placeCvsOrder()
      createMode = "drop"
      const res = await fulfill(order)
      expect({ status: res.status, body: res.status === 200 ? null : res.data }).toEqual({ status: 200, body: null })
      expect(createRequests).toHaveLength(1)
      const f = await fulfillmentOf(order.id)
      const created = trades.get(createRequests[0].MerchantTradeNo)!
      expect(f.data).toMatchObject({
        ecpay_merchant_trade_no: createRequests[0].MerchantTradeNo,
        ecpay_all_pay_logistics_id: created.AllPayLogisticsID,
        ecpay_status: { code: "300" },
      })
      expect(f.labels[0].tracking_number).toEqual("D88445274471")
    })

    it("no answer and ECPay has no such shipment: fails with the trade number for staff", async () => {
      const order = await placeCvsOrder()
      const before = (await ecpayFulfillments()).length
      createMode = "lost"
      const res = await fulfill(order)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(JSON.stringify(res.data)).toContain(createRequests[0].MerchantTradeNo)
      expect((await ecpayFulfillments()).length).toEqual(before)
    })

    it("status notices: shipped -> arrived -> picked up, moving the order; repeats are not re-recorded", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      let f = await fulfillmentOf(order.id)
      const line = async () => (await orderLines(order.id)).items[0].detail

      expect((await postStatus(notice(f, "2068", "賣家已到門市寄件", { UpdateStatusDate: "2026/10/14 10:00:00" }))).data).toEqual("1|OK")
      f = await fulfillmentOf(order.id)
      expect(f.shipped_at).toBeTruthy()
      expect(f.delivered_at).toBeFalsy()
      expect(Number((await line()).shipped_quantity)).toEqual(1)
      expect((await postStatus(notice(f, "2068", "賣家已到門市寄件", { UpdateStatusDate: "2026/10/14 10:00:00" }))).data).toEqual("1|OK") // repeat

      expect((await postStatus(notice(f, "2073", "包裹配達取件門市", { UpdateStatusDate: "2026/10/15 09:00:00" }))).data).toEqual("1|OK")
      f = await fulfillmentOf(order.id)
      expect(f.metadata.ecpay_status.code).toEqual("2073")
      expect(f.delivered_at).toBeFalsy()

      expect((await postStatus(notice(f, "2067", "買家已到店取貨", { UpdateStatusDate: "2026/10/15 18:30:00" }))).data).toEqual("1|OK")
      f = await fulfillmentOf(order.id)
      expect(f.delivered_at).toBeTruthy()
      expect(Number((await line()).delivered_quantity)).toEqual(1)
      expect((await postStatus(notice(f, "2067", "買家已到店取貨", { UpdateStatusDate: "2026/10/15 18:30:00" }))).data).toEqual("1|OK") // repeat

      // A late, older notice is kept in the history but does not replace the current status.
      expect((await postStatus(notice(f, "2073", "包裹配達取件門市", { UpdateStatusDate: "2026/10/15 08:00:00" }))).data).toEqual("1|OK")
      f = await fulfillmentOf(order.id)
      expect(f.metadata.ecpay_status.code).toEqual("2067")
      expect(f.metadata.ecpay_status_history.map((s: any) => s.code)).toEqual(["2068", "2073", "2067", "2073"])
    })

    it("picked-up notice without a prior shipped notice still ships, then delivers", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      expect((await postStatus(notice(f, "2067", "買家已到店取貨"))).data).toEqual("1|OK")
      const after = await fulfillmentOf(order.id)
      expect(after.shipped_at).toBeTruthy()
      expect(after.delivered_at).toBeTruthy()
      const detail = (await orderLines(order.id)).items[0].detail
      expect([Number(detail.shipped_quantity), Number(detail.delivered_quantity)]).toEqual([1, 1])
    })

    it.each([
      ["2074", "買家未取包裹，將退回物流中心", "returning"],
      ["7013", "訂單超過驗收期限（賣家未出貨）", "attention"],
      ["4242", "a code ECPay may add later", "attention"],
    ])("notice %s (%s) is recorded as %s and acknowledged without changing state", async (code, msg, meaning) => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      expect((await postStatus(notice(f, code, msg))).data).toEqual("1|OK")
      const after = await fulfillmentOf(order.id)
      expect(after.metadata.ecpay_status.meaning).toEqual(meaning)
      expect(after.shipped_at).toBeFalsy()
      expect(after.delivered_at).toBeFalsy()
    })

    it("a notice for a canceled fulfillment is recorded and acknowledged, never shipped", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      const admin = await superAdminHeaders(`cancel-${order.id}@drn.test`)
      const cancel = await api.post(`/admin/orders/${order.id}/fulfillments/${f.id}/cancel`, {}, { headers: admin, validateStatus: () => true })
      expect(cancel.status).toEqual(200)
      const res = await postStatus(notice(f, "2068", "賣家已到門市寄件"))
      expect({ status: res.status, body: res.data }).toEqual({ status: 200, body: "1|OK" })
      const after = await fulfillmentOf(order.id)
      expect(after.canceled_at).toBeTruthy()
      expect(after.shipped_at).toBeFalsy()
      expect(after.metadata.ecpay_status.code).toEqual("2068")
    })

    it("a notice for a fulfillment no longer linked to an order is acknowledged, not a 500", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      await getContainer().resolve(ContainerRegistrationKeys.LINK).dismiss({
        [Modules.ORDER]: { order_id: order.id },
        [Modules.FULFILLMENT]: { fulfillment_id: f.id },
      })
      const res = await postStatus(notice(f, "2068", "賣家已到門市寄件"))
      expect({ status: res.status, body: res.data }).toEqual({ status: 200, body: "1|OK" })
      const [row] = await getContainer().resolve(Modules.FULFILLMENT).listFulfillments({ id: f.id }, { select: ["id", "shipped_at", "metadata"] })
      expect(row.shipped_at).toBeFalsy()
      expect((row.metadata as any).ecpay_status.code).toEqual("2068")
    })

    it.each([
      // Signed as "not picked up", then relabelled "picked up": would deliver if unchecked.
      ["tampered", (f: any) => ({ ...notice(f, "2074", "買家未取包裹"), RtnCode: "2067" })],
      ["unknown trade", (f: any) => notice({ data: { ...f.data, ecpay_merchant_trade_no: "DL0000000000000000XX" } }, "2067", "x")],
      ["other shipment id", (f: any) => notice({ data: { ...f.data, ecpay_all_pay_logistics_id: "1" } }, "2067", "x")],
    ])("%s notice -> 400, no state change", async (_n, make) => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      const res = await postStatus(make(f))
      expect(res.status).toEqual(400)
      const after = await fulfillmentOf(order.id)
      expect([after.shipped_at, after.delivered_at, after.metadata?.ecpay_status]).toEqual([null, null, undefined])
    })

    // ---- P4-11 --------------------------------------------------------------------------
    const NEW_711 = { LogisticsSubType: "UNIMARTC2C", CVSStoreID: "131386", CVSStoreName: "新門市", CVSAddress: "台北市信義區市府路1號", CVSOutSide: "0" }
    const reselect = async (orderId: string, body: Record<string, unknown>) =>
      api.post(`/store/orders/${orderId}/ecpay/cvs-store`, body, { headers: await storeHeaders(), validateStatus: () => true })

    it("canceling a 7-ELEVEN shipment cancels it at ECPay (CancelC2COrder)", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      const admin = await superAdminHeaders(`c711-${order.id}@drn.test`)
      expect((await api.post(`/admin/orders/${order.id}/fulfillments/${f.id}/cancel`, {}, { headers: admin, validateStatus: () => true })).status).toEqual(200)
      expect(afterSaleRequests).toEqual([
        { path: "/Express/CancelC2COrder", params: expect.objectContaining({ AllPayLogisticsID: f.data.ecpay_all_pay_logistics_id, CVSPaymentNo: "D8844527", CVSValidationNo: "4471" }) },
      ])
    })

    it("closed pickup store: the shopper picks a new one, ECPay is told, the shipment records it", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      expect((await reselect(order.id, { email: "buyer@drn.test", store: NEW_711 })).status).toEqual(400) // nothing closed yet
      expect((await postStatus(notice(f, "2104", "門市關轉，請重選門市"))).data).toEqual("1|OK")
      expect((await reselect(order.id, { email: "other@drn.test", store: NEW_711 })).status).toEqual(404)
      expect((await reselect(order.id, { email: "buyer@drn.test", store: { ...NEW_711, LogisticsSubType: "FAMIC2C" } })).status).toEqual(400)
      const ok = await reselect(order.id, { email: "buyer@drn.test", store: NEW_711 })
      expect({ status: ok.status, store: ok.data?.store?.store_id }).toEqual({ status: 200, store: "131386" })
      expect(afterSaleRequests.map((r) => r.params)).toEqual([
        expect.objectContaining({ StoreType: "01", ReceiverStoreID: "131386", AllPayLogisticsID: f.data.ecpay_all_pay_logistics_id, CVSValidationNo: "4471" }),
      ])
      const after = await fulfillmentOf(order.id)
      expect(after.data.store).toMatchObject({ store_id: "131386", store_name: "新門市" })
      expect(after.metadata.ecpay_store_updates).toEqual([expect.objectContaining({ store_type: "01", store_id: "131386", by: "shopper" })])
    })

    const fulfillmentsOf = async (orderId: string) => {
      const { data } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "order", fields: ["fulfillments.id", "fulfillments.data", "fulfillments.metadata", "fulfillments.created_at"], filters: { id: orderId } })
      return ((data[0] as any).fulfillments ?? []).sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
    }

    it("one reselect per closure notice: a second caller cannot overwrite it; a new closure opens it again", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      await postStatus(notice(f, "2104", "門市關轉，請重選門市"))
      expect((await reselect(order.id, { email: "buyer@drn.test", store: NEW_711 })).status).toEqual(200)
      const again = await reselect(order.id, { email: "buyer@drn.test", store: { ...NEW_711, CVSStoreID: "999999" } })
      expect({ status: again.status, message: again.data.message }).toEqual({ status: 400, message: "目前沒有需要重選門市的包裹" })
      await postStatus(notice(f, "2104", "門市關轉，請重選門市", { UpdateStatusDate: "2026/10/16 09:00:00" }))
      expect((await reselect(order.id, { email: "buyer@drn.test", store: { ...NEW_711, CVSStoreID: "999999" } })).status).toEqual(200)
      expect(afterSaleRequests.map((r) => r.params.ReceiverStoreID)).toEqual(["131386", "999999"])
    })

    it("two parcels waiting on a closed store: the shopper names the parcel to move", async () => {
      const order = await placeCvsOrder(2)
      expect((await fulfill(order, { quantity: 1 })).status).toEqual(200)
      expect((await fulfill(order, { quantity: 1 })).status).toEqual(200)
      const [a, b] = await fulfillmentsOf(order.id)
      await postStatus(notice(a, "2104", "門市關轉，請重選門市"))
      await postStatus(notice(b, "2104", "門市關轉，請重選門市"))
      const unnamed = await reselect(order.id, { email: "buyer@drn.test", store: NEW_711 })
      expect({ status: unnamed.status, message: unnamed.data.message }).toEqual({ status: 400, message: "有多個包裹需要重選門市，請指定 fulfillment_id" })
      const first = await reselect(order.id, { email: "buyer@drn.test", store: NEW_711, fulfillment_id: a.id })
      expect({ status: first.status, id: first.data.fulfillment_id }).toEqual({ status: 200, id: a.id })
      expect((await reselect(order.id, { email: "buyer@drn.test", store: NEW_711, fulfillment_id: a.id })).data.message).toEqual("這個包裹目前不需要重選門市")
      // only b waits now, so it no longer needs naming
      expect((await reselect(order.id, { email: "buyer@drn.test", store: NEW_711 })).data.fulfillment_id).toEqual(b.id)
    })

    it("a lost or garbled ECPay answer: 502, staff alerted, recorded as unconfirmed, store unchanged", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      await postStatus(notice(f, "2104", "門市關轉，請重選門市"))
      afterSaleGarbled = 502
      const res = await reselect(order.id, { email: "buyer@drn.test", store: NEW_711 })
      expect({ status: res.status, message: res.data.message }).toEqual({ status: 502, message: "綠界沒有確認門市是否已變更，請聯絡客服。" })
      const after = await fulfillmentOf(order.id)
      expect(after.data.store.store_id).toEqual("238669")
      expect(after.metadata.ecpay_store_updates).toEqual([expect.objectContaining({ store_type: "01", store_id: "131386", unconfirmed: true })])
      const admin = await superAdminHeaders(`rs-g-${order.id}@drn.test`, "operations")
      const ret = await api.post(`/admin/orders/${order.id}/ecpay-logistics/return-store`, { fulfillment_id: f.id, store_id: "991182" }, { headers: admin, validateStatus: () => true })
      expect(ret.status).toEqual(502)
    })

    it("ECPay refusing the new store changes nothing", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      await postStatus(notice(f, "2104", "門市關轉，請重選門市"))
      afterSaleRefuse = "新取貨門市代碼與舊取貨門市代碼相同。"
      const res = await reselect(order.id, { email: "buyer@drn.test", store: NEW_711 })
      expect(res.status).toEqual(422)
      expect(JSON.stringify(res.data)).toContain("新取貨門市代碼與舊取貨門市代碼相同")
      expect((await fulfillmentOf(order.id)).data.store.store_id).toEqual("238669")
    })

    it("staff change our return store (StoreType 02); support may not", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      const url = `/admin/orders/${order.id}/ecpay-logistics/return-store`
      const support = await superAdminHeaders(`rs-s-${order.id}@drn.test`, "support")
      expect((await api.post(url, { fulfillment_id: f.id, store_id: "991182" }, { headers: support, validateStatus: () => true })).status).toEqual(403)
      const ops = await superAdminHeaders(`rs-o-${order.id}@drn.test`, "operations")
      expect((await api.post(url, { fulfillment_id: f.id, store_id: " " }, { headers: ops, validateStatus: () => true })).status).toEqual(400)
      expect(afterSaleRequests).toEqual([]) // a blank store never reaches ECPay
      const res = await api.post(url, { fulfillment_id: f.id, store_id: "991182" }, { headers: ops, validateStatus: () => true })
      expect(res.status).toEqual(200)
      expect(afterSaleRequests.map((r) => r.params)).toEqual([expect.objectContaining({ StoreType: "02", ReturnStoreID: "991182" })])
    })

    it("the slip page auto-submits ECPay's signed print form (browser POST, no HashKey)", async () => {
      const order = await placeCvsOrder()
      expect((await fulfill(order)).status).toEqual(200)
      const f = await fulfillmentOf(order.id)
      const admin = await superAdminHeaders(`pr-${order.id}@drn.test`)
      const res = await api.get(`/admin/orders/${order.id}/ecpay-logistics/print?mode=2`, { headers: admin, validateStatus: () => true })
      expect(res.status).toEqual(200)
      const html = String(res.data)
      expect(html).toContain('action="https://logistics-stage.ecpay.com.tw/Express/PrintUniMartC2COrderInfo"')
      const fields = Object.fromEntries([...html.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]))
      expect(fields).toMatchObject({ AllPayLogisticsID: f.data.ecpay_all_pay_logistics_id, CVSPaymentNo: "D8844527", CVSValidationNo: "4471", PrintMode: "2" })
      expect(verifyCheckMacValue(fields, LOG_MAC)).toBe(true)
      expect(html).not.toContain(LOG_MAC.hashKey)
    })
  },
})
