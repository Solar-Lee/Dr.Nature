# 綠界物流（C2C 超商取貨）測試環境實測紀錄（2026-10-13 台北）

商店：綠界**公開** C2C 測試帳號 2000933（developers.ecpay.com.tw/7398/，非機密）。只建立測試物流單；未輸入任何登入資訊。

## 1. 電子地圖 + Express/Create（`src/scripts/ecpay-logistics-stage-probe.ts`）

我方 `buildMapForm` 送到 `logistics-stage.ecpay.com.tw/Express/map`，三家皆 HTTP 200，轉到各超商的**測試**地圖頁（7-ELEVEN 頁面註明「此為測試環境畫面，僅供測試所用」），測試門市固定：

| 子類型 | 測試門市（取自 stage 地圖頁） | Express/Create 結果（我方 MD5 簽章） | 回應 CheckMacValue | 回傳單號 |
|---|---|---|---|---|
| UNIMARTC2C | 238669 經貿／台北市南港區三重路19號1樓 | `1|...`，RtnCode 300「訂單處理中(綠界已收到訂單資料)」 | 驗證通過 | AllPayLogisticsID、CVSPaymentNo、CVSValidationNo |
| FAMIC2C | 002816 板橋板農店 | `1|...`，RtnCode 300 | 驗證通過 | AllPayLogisticsID、CVSPaymentNo（**無** CVSValidationNo） |
| HILIFEC2C | 2001 北市杭州店 | `1|...`，RtnCode 2001「訂單傳送超商成功」 | 驗證通過 | AllPayLogisticsID、CVSPaymentNo（**無** CVSValidationNo） |

Express/Create 回應 `Content-Type: text/html; charset=utf-8`，本文 `1|k=v&...`；欄位：AllPayLogisticsID、BookingNote、CheckMacValue、CVSPaymentNo、CVSValidationNo、GoodsAmount、LogisticsSubType、LogisticsType、MerchantID、MerchantTradeNo、ReceiverAddress、ReceiverCellPhone、ReceiverEmail、ReceiverName、ReceiverPhone、RtnCode、RtnMsg、UpdateStatusDate。

## 2. 經由我方 provider 的端到端（`src/scripts/ecpay-stage-e2e.ts`，僅 development + 本機 DB + stage）

本機 dev server（`infra/dev-env.sh`）→ 店面 API 下單（7-ELEVEN 超商取貨選項、測試門市 238669、綠界付款 session）→ Medusa `createOrderFulfillmentWorkflow` → **我方** `ecpay_logistics` provider 呼叫真實 stage `Express/Create`：

```
{"order":1,"fulfillment_provider":"ecpay_logistics","ecpay_all_pay_logistics_id":"3690138",
 "ecpay_cvs_payment_no":"D8844528","ecpay_cvs_validation_no":"4456",
 "ecpay_status":{"code":"300","message":"訂單處理中(綠界已收到訂單資料)"},"tracking_number":"D8844528-4456"}
```

## 由實測確認

1. 我方 MD5 CheckMacValue、MerchantTradeNo（`DL`+時間+亂數）、收寄件人姓名／手機、GoodsName（含中文）、GoodsAmount、C2C 三家子類型欄位格式皆被綠界接受。
2. 成功回應的 CheckMacValue 以我方實作驗證通過；`parseCreateShipmentResponse` 正確解析 `1|...`。
3. 全家、萊爾富 C2C 不回 CVSValidationNo；託運單號 `tracking_number` 只用 CVSPaymentNo（程式已處理）。
4. RtnCode 300 與 2001 皆為建立成功；後續狀態以 ServerReplyURL 通知為準。

## 仍未驗證（需公開 HTTPS 網址，P12 部署後）

- 綠界實際呼叫我方 `/hooks/ecpay/logistics`（狀態通知）與 `/checkout/ecpay/cvs-store`（電子地圖回傳）；本機網址綠界連不到，**stage 也不會主動推送狀態**。狀態處理目前由整合測試以簽章通知覆蓋。
- 正式環境寄件人須為**個人姓名**＋手機（`ECPAY_LOGISTICS_SENDER_*`，見 docs/ENV.md）；C2C 合約是否含黑貓宅配（`home-tcat` 已建立但未上架）。
