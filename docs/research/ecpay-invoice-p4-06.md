# P4-06 電子發票：查證紀錄（2026-10-13）

延續 [ecpay.md](ecpay.md) INV-01～INV-15。本次以「研究代理＋獨立懷疑者複核」查證三類問題，並以**真實綠界測試環境**實測（`apps/backend/src/scripts/ecpay-invoice-stage-probe.ts`；公開測試商店 2000132，測試環境發票不會上傳財政部）。

## 1. 真實測試環境實測（2026-10-13 03:50–04:00 台北）

| 動作 | 結果 |
|---|---|
| AES 信封 | 我方加密與官方範例（developers.ecpay.com.tw/7958/）逐字相同；`RqHeader` 只帶 `Timestamp`（不帶 `Revision`）即被接受 |
| Issue（會員載具、2 瓶 NT$2,300） | `RtnCode 1`「開立發票成功」，回 `InvoiceNo`（如 LO22068041）、`InvoiceDate` `yyyy-MM-dd HH:mm:ss`、`RandomNumber` 4 碼 |
| 相同 RelateNumber 再開 | `RtnCode 5070357`「B2C開立發票 自訂編號重覆，請重新設定」（官方文件未列此碼） |
| GetIssue 只帶 RelateNumber | `RtnCode 1`；欄位 `IIS_Number`、`IIS_Create_Date`、`IIS_Random_Number`、`IIS_Relate_Number`、`IIS_Invalid_Status`、`IIS_Sales_Amount` 等 |
| GetIssue 不存在的 RelateNumber | `RtnCode 2`「查無發票資料，請重新確認」 |
| Invalid（作廢） | `RtnCode 1`「作廢發票成功」；之後 GetIssue `IIS_Invalid_Status` 由 `0` 變 `1` |
| 再作廢一次 | `RtnCode 5070453`「B2C作廢發票 該發票已被作廢過」 |
| 作廢不存在的發票號碼 | `RtnCode 1600003`「無發票號碼資料」 |
| CheckBarcode／CheckLoveCode | `RtnCode 1`、`IsExist`（測試環境對 `/ABC+123`、`168001` 回 `Y`） |
| GetCompanyNameByTaxID | 97025978 → 綠界科技股份有限公司；12345678 → `RtnCode 1200125`「統一編號檢查碼驗證失敗」 |
| 回應外層 | HTTP 200、`application/json`；`PlatformID, MerchantID, RpHeader, TransCode, TransMsg, Data` |
| 單價×數量≠合計（3 × 1116.67 vs 3350） | `RtnCode 1` 開立成功（LO22068057），隨即作廢；綠界接受小數單價的捨入誤差 |

→ 設計：每張訂單固定 RelateNumber（訂單 id 去掉 `order_`，26 碼 ULID）；開立失敗或沒收到回應時一律先 GetIssue，查得到就沿用，**不會重複開立**。作廢失敗時以 GetIssue 的 `IIS_Invalid_Status` 判定是否其實已作廢。

## 2. 綠界 API（文件，懷疑者複核）

- **GetIssue**（developers.ecpay.com.tw/7923/）：情境一只帶 `RelateNumber` 即可查；`IIS_Issue_Status` 1 開立／0 註銷，`IIS_Invalid_Status` 1 已作廢／0 未作廢。✅
- **通知**（7938、63356、64067）：綠界只在【廠商後台＞發票通知方式設定】開啟時才通知買受人；若改用 InvoiceNotify API，後台須設為「不要開啟」，否則每張發票寄兩封。**測試環境一律不寄通知**。中獎由綠界每逢單月 29 日檢查，須先設定通知方式。✅
- **金額**（7896）：SalesAmount 整數；ItemPrice 可有小數；所有 ItemAmount 四捨五入後加總須等於 SalesAmount；vat=1（含稅）時 ItemPrice×ItemCount=ItemAmount；一般商品 InvType 07、TaxType 1。✅
- **作廢**（7906）：有折讓的發票須先作廢折讓；每逢單月 13 日 23:59:59 後不能作廢前一期發票。✅
- 文件未載明的錯誤碼（重複編號、重複作廢）已由第 1 節實測補齊。

## 3. 台灣法規（懷疑者複核；來源為全國法規資料庫／財政部）

1. **開立時點**：加值型及非加值型營業稅法第 32 條及其「營業人開立銷售憑證時限表」買賣業：於發貨時開立，但**發貨前已收之貨款應先行開立**。網購先付款 → 收款時開立。來源：law.moj.gov.tw（pcode=G0340080 第 32 條；時限表 FileId=0000233502）。✅
2. **作廢／折讓需買受人同意**：電子發票實施作業要點**第九點**，作廢與折讓均須經買受人同意，同意證明至少保存 **5 年**；以網站或電話合意者須有安全措施並保存紀錄（第三點第 2 項）。來源：law-out.mof.gov.tw（id=FL041411）。✅ → **取消訂單不自動作廢**，改由後台填寫同意方式與紀錄後作廢。
3. **上傳時限**：非營業人買受人之作廢、折讓資料於次日起 2 日內上傳；營業人買受人 7 日（財政部 113-12-12 公告時限表，114-01-01 施行）。綠界代為上傳。✅
4. **必須接受的載具**：共通性載具（**手機條碼、自然人憑證條碼**）與**捐贈碼**於交易時要求不得拒絕（要點第二十一點第 3 項、第二十二點(二)）；無實體店面者須提供網站輸入。✅ 已全部支援。
5. **應告知買受人事項**：要點第十九點（一）～（七）：可用載具、紙本證明聯取得方式、上傳義務、平台查詢網址與方式、兌獎方式、捐贈事項、其他權益。→ 前台結帳／訂單頁（P7-05／P7-06）實作。
6. **統編（營業人買受人）**：不強制紙本；上傳後平台通知，買受人未設定接收方式時由開立人通知（使用辦法第 7 條第 5、6 項）。綠界：有統編且 Print=0 時須有載具（1、2 或 3）。→ 我們用統編＋會員載具、不印紙本。✅
7. **中獎通知**：會員載具未歸戶時，營業人須於開獎次日起 10 日內通知中獎人並提供證明聯，紀錄保存 1 年（要點第二十四點）；綠界可代發通知（須於後台設定）。→ U-14。

## 4. Medusa 2.21.2（原始碼，懷疑者複核）

- ReturnURL 入帳後只發出 `payment.captured { id: 付款 id }`（capture-payment.js:53-56）；正常流程訂單在付款前已建立（`order.placed`）。→ 訂閱兩者，由付款反查訂單。✅
- `order.canceled { id }` 在取消流程整體成功後才發出（cancel-order.js:107-160）。✅
- 完成購物車時 `cart.metadata` 整包複製到訂單（complete-cart.js:454），之後不再同步。→ 發票選擇須在結帳完成前寫入 `cart.metadata.ecpay_invoice_choice`。✅
- `orderModule.updateOrders` 的 metadata 只做**最上層**合併、`""` 刪鍵；`null` 會清空全部 metadata（medusa-internal-service.js:233-239、merge-metadata.js）。→ 發票紀錄一律整包寫在 `metadata.ecpay_invoice`，補償時寫回舊值或 `""`。✅
- `updateOrderWorkflow` 拒絕已取消訂單 → 作廢紀錄改用 order module 直接寫入。✅
- 訂單與品項 `total` 為含稅、已扣折扣（utils totals）；只在查詢有選最上層 `total` 時才計算。✅
- `completeCartWorkflow.hooks.validate` 只能註冊**一個** handler（create-hook.js:72-73）。→ 物流與發票檢查合併在 `src/workflows/hooks/complete-cart-validate.ts`。
- `acquireLockStep`／`releaseLockStep` 可用；鍵加 `drn-einvoice:` 前綴避開核心鎖。✅

## 5. 經由我方程式的端到端（`src/scripts/ecpay-invoice-stage-e2e.ts`，2026-10-13 04:25）

本機 dev server（Redis 事件匯流排）→ 店面 API 下單（7-ELEVEN 取貨、會員載具、2 瓶）→ 以正確簽章送 ReturnURL 付款通知 → **我方訂閱者**收到 `payment.captured` → 真實綠界 stage 開立 **LO22068054**（NT$2,300，隨機碼 3706）→ 我方作廢流程（同意方式 web）→ 綠界 GetIssue `IIS_Invalid_Status=1`。

```
{"order":5,"payment_ack":"1|OK","invoice":{"status":"issued","invoice_no":"LO22068054","random_number":"3706","sales_amount":2300,"choice":{"type":"member"}},
 "ecpay_before_void":{"invoice_no":"LO22068054","sales_amount":2300,"voided":false},"our_record_after_void":{"status":"voided","consent":"web"},"ecpay_after_void":{"voided":true}}
```

審查修正後再跑一次（04:47，同一腳本擴充）：付款 → 開立 **LO22068059**（會員載具）→ 有效訂單**作廢＋重開**（同意紀錄、改為統編 97025978、自填抬頭「綠界」）→ 綠界顯示 LO22068059 已作廢、以 RelateNumber `…R1` 開立 **LO22068060**，買受人名稱為登記名稱「綠界科技股份有限公司」→ 取消訂單（退款告警含發票提醒）→ 作廢 LO22068060 → 綠界 GetIssue 確認已作廢。

**實測教訓（部署須知）**：前兩次失敗是本機殘留的舊版 `medusa develop` 行程（無發票訂閱者）也連在同一個 Redis 佇列，搶走了 `payment.captured` 事件。Redis 事件匯流排上**任何**worker 都可能取走事件；部署時新舊 worker 並存，事件可能被舊版吃掉。對策：①每 15 分鐘重試排程會補開（已有整合測試）；② P12 部署程序須先停舊 worker 再啟新版。

## 6. 未驗證／待辦

- 正式環境發票商店是否與金流共用 MerchantID：未載明，維持三組獨立設定（INV-06）。
- 正式商店「發票通知方式」預設值未載明 → U-14 由 Aki 在正式後台設定（開立、作廢、中獎通知以 Email）。
- 綠界線上折讓（AllowanceByCollegiate）的同意紀錄是否符合要點第三點：未查證；折讓（部分退款）留待 P4-08。
