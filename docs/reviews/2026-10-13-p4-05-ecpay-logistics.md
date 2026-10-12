# P4-05 綠界物流（C2C 超商取貨）審查紀錄（2026-10-13）

範圍：commit 2f2406f 全部物流程式。3 名審查者（安全／Medusa 正確性／綠界規格逐欄比對），每項由 CODE 對照 Medusa 2.21.2 原始碼與綠界官方頁面複核；綠界行為以真實測試環境再驗證（docs/research/ecpay-logistics-stage-probe-2026-10-13.md）。安全面：**未發現**可偽造、重放或轉向狀態通知，或注入出貨欄位的方法。

| 嚴重度 | 摘要 | 處置 |
|---|---|---|
| medium | 申報金額（GoodsAmount）用整筆訂單 item_total：部分出貨高報；> NT$20,000 或 NT$0 的訂單永遠無法出貨 | 修正：依本次出貨品項計算（含稅、折扣後；套組換算 required_quantity）；0 元申報 NT$1；> 20,000 回中文錯誤要求分筆出貨。單元＋整合測試（數量 2、部分出貨 1） |
| medium | 綠界已建單但回應逾時／遺失 → Medusa 刪除出貨紀錄，重試造成第二張物流單；無任何告警 | 修正：無回應或回應不可用時以 QueryLogisticsTradeInfo/V5 查詢（真實 stage 已驗證格式與簽章、未知單回 `0|找不到訂單`），查到則沿用該物流單；查不到則 [ECPAY-ALERT]＋錯誤訊息附 MerchantTradeNo。整合測試（drop／lost 兩情境） |
| medium | 已取消且無訂單連結的出貨收到通知 → 500，綠界持續重送 | 修正：先記錄狀態，已取消／無訂單一律告警＋ACK，不出貨。整合測試（取消、解除連結） |
| medium | 收件人姓名／手機只在選物流時檢查，之後改地址不會再檢查；管理員指定的 delivery_address 被忽略；order.email 未載入致 ReceiverEmail 從未送出 | 修正：completeCartWorkflow validate hook 結帳時重驗；出貨改用 Medusa 合併後的 delivery_address；Email 改取 customer.email 且僅在 ≤50 字、格式正確時送出。整合測試 |
| medium | 多個 C2C 狀態碼未對應（門市關轉 2037／7032／2028／2101、退回寄件門市、遺失、7013 逾期未寄），未知碼一律視為 info 不告警 | 修正：依綠界狀態碼表（7440 連結之活頁簿）補齊；**未列出的代碼一律 attention 告警**。單元＋整合測試 |
| low | 建單成功回應未附 CheckMacValue 仍被接受；未檢查 MerchantTradeNo 回傳是否相符；缺 AllPayLogisticsID 存成空字串，使通知比對被略過 | 修正：成功回應必須簽章正確、商店與交易編號相符、有物流單號（三家真實 stage 回應皆符合）；通知比對改為嚴格相等 |
| low | 狀態被較舊的重送通知覆蓋；重送重複寫入歷史並重複告警 | 修正：同代碼＋同時間視為重複（不記錄、不告警）；較舊狀態只進歷史不覆蓋目前狀態。整合測試 |
| low | 7-ELEVEN 交貨便代碼應為 CVSPaymentNo＋CVSValidationNo 直接組合（7418 頁），我們加了「-」 | 修正：shipmentCode() |
| low | MerchantTradeDate 用出貨時間；綠界要求消費者交易當下時間 | 修正：用訂單建立時間 |
| low | 正式環境可誤用綠界公開測試商店 | 修正：ECPAY_ENV=prod 時拒絕 2000132／2000933 |
| low | config 註解稱合約「免改程式即可切換」不實 | 修正註解（切換須重建運送選項） |
| test | 「不留殘留」以訂單查詢（漏掉無連結資料）；通知測試未驗證訂單品項出貨／送達數量；竄改測試的斷言恆真 | 修正：改查 fulfillment 模組；斷言 shipped／delivered_quantity；竄改案例改為「未取貨」簽章改標「已取貨」 |

**反向測試（mutation）**：10 個針對性破壞（整單金額、關閉查詢補救、先要求訂單、關閉去重、舊狀態覆蓋、關閉結帳檢查、不驗通知簽章、忽略 delivery_address、已取消仍出貨、未知碼不告警）全部使測試轉紅。

## 不在本次修正、已列入 P4-11

- 門市關轉後替顧客重選門市（`/Express/UpdateStoreInfo`，8907 頁）：需要前台重開電子地圖，依賴 P7-05。目前以告警＋後台處理。
- 7-ELEVEN C2C 取消（`/Express/CancelC2COrder`，7412 頁）；全家／萊爾富 C2C 無取消 API。目前取消出貨為告警＋後台作廢。
- 列印託運單（7406／8848／8858）與寄件期限（C2C 訂單有效日：7-ELEVEN 5 日、全家 6 日、萊爾富 7 日，7444 頁）：出貨 SOP 與後台按鈕。
- 同時到達的兩則通知可能遺失一筆歷史（讀改寫）；僅影響歷史顯示，不影響訂單狀態。
