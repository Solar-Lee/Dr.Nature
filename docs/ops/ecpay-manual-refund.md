# SOP：綠界退款（手動，直到 P4-08 自動化）

適用：在 Medusa 後台對綠界付款的訂單「退款」或「取消已付款訂單」。綠界的退款 API（CreditDetail/DoAction）只在正式環境提供、測試環境無法驗證，因此目前 Medusa 只**記錄**退款，實際退款要在綠界廠商後台執行。

## 誰可以做
- 只有 Super Admin（RBAC：退款／請款政策在 Medusa 2.21.2 未開放給其他角色）。

## 步驟
1. Medusa 後台：對訂單按「退款」或「取消訂單」。系統會在付款資料中新增一筆 `ecpay_manual_refunds`，狀態 `manual_pending`，並在後端日誌寫一行 `[ECPAY-ALERT] manual refund required`（含 MerchantTradeNo 與綠界 TradeNo）。
2. **當天**登入綠界廠商後台 → 一般訂單查詢 → 全方位金流訂單 → 以 MerchantTradeNo 搜尋 → 依付款方式辦理退款（信用卡：退刷；ATM／超商：依綠界流程退款到顧客帳戶）。
3. 在訂單備註記錄：退款日期、金額、綠界退款序號。
4. 每週對帳：日誌中所有 `[ECPAY-ALERT] manual refund required` 都要能對到綠界後台的退款紀錄。

## 其他告警（`[ECPAY-ALERT]`）
| 訊息 | 意義 | 處理 |
|---|---|---|
| `paid after order … was canceled` | 訂單已取消後顧客仍完成付款；Medusa **未**入帳，訂單 metadata 有 `ecpay_paid_after_cancel` | 綠界後台全額退款，或與顧客確認後重新成立訂單 |
| `paid notice without a matching ECPay payment session` | 綠界回報已付款，但對應的付款 session 已不存在（綠界會持續重送） | 以 MerchantTradeNo 在綠界後台查詢，人工對應訂單後退款或補登 |
| `amount mismatch` | 綠界簽章通知的金額與訂單不符；未入帳 | 立即人工檢查，原則上全額退款 |
