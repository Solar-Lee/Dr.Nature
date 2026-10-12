# ECPay 測試環境實測紀錄（2026-10-13 02:48 台北）

工具：`apps/backend/src/scripts/ecpay-stage-probe.ts`（僅 `ECPAY_ENV=stage` 可執行）。商店：ECPay 公開測試帳號 3002607（頁面顯示「測試帳號三」）。未輸入任何卡號或登入資訊；只建立未付款的測試交易。

| 付款方式 | 我方簽章表單送到 `payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5` | QueryTradeInfo（真實 stage） |
|---|---|---|
| Credit | HTTP 200，「選擇支付方式｜綠界科技」，顯示訂單編號、NT$1,150、付款方式「信用卡」（同頁另列 Apple Pay、iPASS MONEY、街口支付、綠界Pay）；無 CheckMacValue／參數錯誤 | HTTP 200，簽章驗證通過，TradeStatus=0 |
| ATM | 同上，付款方式「ATM虛擬帳號」 | 同上 |
| CVS | 同上，付款方式「超商代碼」 | 同上 |
| BARCODE | 同上，付款方式「超商條碼」 | 同上 |

## 由實測確認、可從「未驗證」移除的項目

1. **QueryTradeInfo 回應格式**：`Content-Type: text/html; charset=utf-8`，但本文為 `key=value&...`（URL query string）。欄位：CustomField1-4、HandlingCharge、ItemName、MerchantID、MerchantTradeNo、PaymentDate、PaymentType、PaymentTypeChargeFee、StoreID、TradeAmt、TradeDate、TradeNo、TradeStatus、CheckMacValue。
2. **QueryTradeInfo 回應的 CheckMacValue** 以我方實作（含空值欄位）驗證通過。
3. 未付款交易 `TradeStatus=0`；交易建立後即配發 TradeNo。
4. 我方 CheckMacValue、MerchantTradeNo（20 碼）、MerchantTradeDate（台北時間）、ItemName（含中文）、ATM `ExpireDate`、CVS／BARCODE `StoreExpireDate`、`PaymentInfoURL` 欄位格式皆被綠界接受。

## 仍未驗證（需公開 HTTPS 網址，P4-04 驗收／P12 部署後）

- 綠界實際呼叫我方 ReturnURL／PaymentInfoURL（本機網址綠界連不到）。
- 測試卡付款完成後 QueryTradeInfo 的 TradeStatus=1 與 PaymentType 值。
- ATM／超商在測試環境只能用廠商後台「模擬付款」（SimulatePaid=1）；端到端測試時暫時設定 `ECPAY_ACCEPT_SIMULATED_PAYMENTS=true`（僅 stage）。
