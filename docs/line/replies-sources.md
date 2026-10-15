# LINE 自動回覆：出處與更新條件

對象：[apps/backend/src/data/line-replies.json](../../apps/backend/src/data/line-replies.json)（文字由 CODE 的 LINE 內容車道撰寫，後端只讀取）。人設規則見 [content/line/persona.md](../../content/line/persona.md)。

## 1. 檔案格式（車道間共用契約，不得改形）

```
{"version":1,
 "greeting":{"text":string},
 "fallback":{"text":string},
 "handoff":{"keywords":string[],"text":string},
 "intents":[{"id":string,"keywords":string[],"reply":{"text":string},
             "quickReplies":[{"label":string,"text":string}]}]}
```

- 後端的讀取器要容許檔案不存在（契約 2）；本檔不加任何額外欄位，出處寫在這裡而不是 JSON 裡。
- `quickReplies[].text` 是使用者點按鈕後送出的文字，一律等於某個意圖或 `handoff` 的關鍵字，所以點了就會命中。
- 關鍵字在所有意圖與 `handoff` 之間不重複，而且任何一個關鍵字都不是另一個意圖關鍵字的子字串。後端用「訊息包含關鍵字」比對時，單獨輸入任何一個關鍵字只會命中一個意圖；一則訊息同時含有兩個意圖的關鍵字時，取哪一個由後端決定（建議依 `intents` 陣列順序取第一個，`handoff` 最優先）。
- 快速回覆按鈕最多 13 個（LINE Messaging API OpenAPI `QuickReply.items.maxItems: 13`，line/line-openapi `messaging-api.yml`，2026-10-15 取得，該檔最後修改提交 fa5577c9）。本檔每則最多 3 個。按鈕文字的長度上限 OpenAPI 沒有寫：TODO(需查證)；本檔一律 ≤10 字。
- 每則文字 ≤300 字（本專案規則）。

## 2. 每則回覆的出處

| 鍵 | 內容重點 | 出處 | 何時要改 |
|---|---|---|---|
| `greeting` | 自動回覆、人設與揭露句、不提供個人健康建議、尚未開賣、開賣與會員開放時通知、免責兩句 | persona.md §1；claims.md:30、:40-41；regulatory.md:60-61；車道契約 5（可承諾「開賣與會員開放時通知」） | G7 開賣時改掉「尚未開賣」；LN-03 第 3 輪簽核後才上線 |
| `fallback` | 可輸入的關鍵字、轉真人、身體狀況問題以標示為準或請教醫療專業人員 | persona.md §3 第 8 條、§5 | 新增意圖時同步更新關鍵字清單 |
| `handoff` | 留言、附訂單編號、真人在聊天室回覆、不傳密碼與卡號 | persona.md §5 | **Aki 指定真人回覆人員前不得上線**（persona.md §5） |
| `order` | 尚未開賣、沒有訂單、開賣與會員開放時通知 | docs/DEV_PLAN.md G7（未開賣）；車道契約 5 | G7：改成會員中心的訂單查詢方式（P7-06） |
| `shipping` | 尚未開賣；開賣後寄到超商門市（7-ELEVEN、全家、萊爾富） | DEV_PLAN.md A6 | G7：補上出貨時程；LINE-14 與 LN-05 後才可提出貨通知 |
| `logistics` | 綠界超商店到店、電子地圖選門市、宅配與運費以結帳頁為準、取件期限以超商通知為準 | DEV_PLAN.md A2、A6、P4-05；docs/research/ecpay.md LOG-07（電子地圖） | G7：運費與宅配定案後改寫；取件期限 TODO(需查證) |
| `invoice` | 電子發票（綠界）；會員載具、手機條碼、自然人憑證條碼、捐贈碼、統一編號 | DEV_PLAN.md P4-06、P7-05；docs/research/ecpay-invoice-p4-06.md:37、:39 | G7：與結帳頁實際選項對照 |
| `returns` | 消保法 §19：收到商品起 7 日內可解除契約；申請方式開賣時公布 | docs/research/p4-p5-2026-10-13.md:44 | G7：連到正式退換貨頁（P7-10） |
| `payment` | 結帳流程中付款、規劃透過綠界、可用方式以結帳頁為準、不傳卡號 | DEV_PLAN.md A2、P4-04（狀態未全綠，所以不列方式） | G7：P4-04 各方式驗收後，可列出實際方式 |
| `label` | 食用量、食用方法、適用年齡、膠囊能否打開、成分與菌種：以標示為準；標示定稿中 | content/brand/story.md:197；regulatory.md:43-45；DEV_PLAN.md U-08 | U-08 與標示定稿後，逐字改成標示內容 |
| `storage` | 保存方式以標示為準；效期兩年；有效日期依規定印在包裝上 | catalog.json:15（shelf_life_months 24）；regulatory.md:39（食安法 §22）；story.md:253 | U-08 後補上保存方式原文 |
| `products` | 規格相同；以編號 01／02／03 與 catalog 暫定品名區分；說明一款一頁；成分以標示為準 | catalog.json:9-40；story.md:192 | G2 品名定案後改名（注意：預覽版前台目前顯示的品名與 catalog.json 不同，見下方「待決」） |
| `price` | 60 顆、效期兩年、NT$1,150；開賣時以公告為準；團購價以團購頁為準 | catalog.json:14-16、:25-27、:36-38；品牌資訊總覽 redacted 版第 17 行；story.md:200 | G7、P1-07（團購價格政策） |
| `groupbuy` | 留言方式；表單與分潤後台上線後開放；標示「合作」或「廣告」；團購價以團購頁為準 | apps/storefront/app/wholesale/page.tsx（「申請合作」區塊）；story.md:195、:200；claims.md:32 | P9（分潤後台）上線後改連申請表單；**Aki 指定回覆的人前不得上線** |
| `member` | 會員與 LINE 綁定還沒開放；開放時通知；不傳密碼 | 車道契約 5；DEV_PLAN.md LN-05（未完成） | LN-05 上線後改寫 |
| `director` | story.md:316 那一句、揭露句、自動化揭露、只提供已查證的資料 | story.md:316；cro.md:13-16、:29；品牌資訊總覽 redacted 版第 81 行；DEV_PLAN.md U-12（2026-10-15 涵蓋 LINE OA） | 只在 cro.md 有新的「已驗證」內容時才改 |
| `privacy` | 訊息由客服系統接收並用來回覆、同時轉給團購合作系統（G3 ③）、不傳個資、政策上線前公布、查詢或刪除轉真人 | DEV_PLAN.md G3（2026-10-15 ③）；apps/storefront/content/preview-copy.json privacy「正式版」段；p4-p5-2026-10-13.md:45 | P7-10 隱私權政策公布後，改成連到政策頁 |

## 3. 驗收方式（每次修改都要跑）

```bash
node scripts/claims-lint.mjs content/line apps/backend/src/data/line-replies.json   # 0 error(s)
node -e 'JSON.parse(require("fs").readFileSync("apps/backend/src/data/line-replies.json","utf8"))'
```

再逐項確認（LN-03 提交時以一次性腳本檢查過；後端讀取器的測試應納入同樣的規則）：
1. 頂層與每個意圖的欄位完全符合第 1 節，沒有多餘欄位；`version` 為 1；意圖 10–14 個。
2. 每則文字 ≤300 字；全部文字不含「醫師」「醫生」「推薦」「保證」「訂單通知」「補貨提醒」與驚嘆號。
3. `greeting` 含揭露句、自動化揭露與免責兩句（逐字）；任何提到研發長姓名的文字都含揭露句。
4. 關鍵字不重複、不互為子字串；每個快速回覆按鈕與 `fallback` 列出的每個詞，都只命中一個意圖。

claims-lint 只比對字串，抓不到暗示；改完仍要照 persona.md 第 3 節逐條人工看過。

## 4. 待決

- **品名不一致**：catalog.json（Medusa 種子資料）是「Dr.Nature 益生菌 A／B／C」，預覽版前台 apps/storefront/lib/site.ts 顯示另一組品名，而 DEV_PLAN G2 仍是 ⏳。`products` 意圖先跟 catalog.json。G2 定案後兩邊一起改。
- **真人回覆的人與時段**、**replyToken 在 G3 ③ 下由哪一邊回覆**、**OA Manager 歡迎訊息是否重複**：見 persona.md §5。
