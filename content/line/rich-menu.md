# LINE 圖文選單規格（第一版，六格）

機器可讀版：[rich-menu.json](rich-menu.json)，內容就是 Messaging API「建立圖文選單」的請求本文（`RichMenuRequest`），沒有多餘欄位，後端同步路由可以原樣送出。人設與用字規則見 [persona.md](persona.md)；第二輪的雙頁選單見 [docs/line/rounds.md](../../docs/line/rounds.md)。

## 0. 閘門

| 項目 | 狀態 |
|---|---|
| G3 webhook 歸屬 | ✅ 2026-10-15 重裁為 ③（docs/DEV_PLAN.md G3 列）：Medusa 接 webhook，`link`、`quiz:start` 兩個 postback 由 Medusa 處理 |
| 用哪個工具管理預設選單 | ⬜ Aki 決定：Messaging API（後端 admin 路由，LINE-08；本檔的 JSON 給它用）或 LINE Official Account Manager（手動，本檔只當文字規格）。**同一份選單只用一種工具** |
| 選單圖 | ⬜ DESIGN 依第 2 節出圖；CODE 不決定視覺 |
| 上線前 | LINE-14（webhook 切換）✅、LN-03 人設第 3 輪簽核、前台正式網址可以開啟（見第 4 節） |

## 1. 版面與動作

全幅 2500 × 1686 px，三欄兩列。座標左上角為 (0, 0)；六格剛好鋪滿整張圖，不重疊。

| 格 | 位置 x, y, 寬, 高 | 文字（DESIGN 排在圖上） | 動作 | 值 |
|---|---|---|---|---|
| A | 0, 0, 833, 843 | 產品／先讀標籤，再決定。 | `uri` | https://dr.nature.smilelife.tw/products/?utm_source=line&utm_medium=richmenu&utm_content=products |
| B | 833, 0, 833, 843 | 知識誌 | `uri` | https://dr.nature.smilelife.tw/journal/?utm_source=line&utm_medium=richmenu&utm_content=journal |
| C | 1666, 0, 834, 843 | 常見問題 | `uri` | https://dr.nature.smilelife.tw/faq/?utm_source=line&utm_medium=richmenu&utm_content=faq |
| D | 0, 843, 833, 843 | 會員綁定（即將開放） | `postback` | `data: "link"`，`displayText: "會員綁定"` |
| E | 833, 843, 833, 843 | 真人客服 | `message` | `text: "真人"`（命中 line-replies.json 的 `handoff`） |
| F | 1666, 843, 834, 843 | 小測驗（讀標籤 5 題） | `postback` | `data: "quiz:start"`，`displayText: "小測驗"`（題目見 [quiz.json](quiz.json)） |

- `chatBarText`：「Dr.Nature 選單」（12 字）。
- `selected`：`true`，聊天室打開時選單預設展開。
- `name`：`drn-main-v1`（只在後台辨識用，不會顯示給使用者）。
- `uri` 的網址主機取自 docs/ENV.md 的 `NEXT_PUBLIC_BASE_URL`（`https://dr.nature.smilelife.tw`）；`utm_*` 參數讓第二輪可以從存取紀錄或訂單 metadata（P8-06）分辨點擊來自哪一格。
- 後端行為：
  - `link`：LN-05 會員綁定上線前，回 line-replies.json 的 `member` 意圖文字（即將開放）；上線後改走綁定流程。
  - `quiz:start`：回 quiz.json 的開場與第 1 題。
  - `真人`：一般文字訊息，照 line-replies.json 的關鍵字比對進 `handoff`。

## 2. 給 DESIGN 的出圖規格

- 尺寸：2500 × 1686 px。這是 LINE 文件「Using rich menus」中建立選單範例所用的尺寸（2. Create a rich menu），文件沒有把它寫成唯一規格。
- 圖檔格式、最小與最大尺寸、長寬比、檔案大小上限：該頁只寫「見 Messaging API reference 的 Requirements for rich menu image」，本次取得的兩份來源都沒有數字：**TODO(需查證)**。上傳範例用的是 `Content-Type: image/png`（同頁 3. Upload and attach the rich menu image）。
- 文字：只用第 1 節表格的文字。產品格用 Slogan 副句「先讀標籤，再決定。」（content/brand/slogan.md:53，購買前的接觸點）。
- 不放：研發長的姓名、照片、學歷（slogan.md:65；persona.md §6）；Slogan 主句與研發長同框；任何功能句（content/brand/story.md:192）；白袍、聽診器、處方、試管、量筒等意象（story.md:206、:231；slogan.md:67）；驚嘆號、倒數、限時（story.md:215）；浴室、潮濕處或伸手可及的擺放情境（story.md:212）。
- 「會員綁定」格標「即將開放」，LN-05 上線後再拿掉。
- 交件位置：`design/line-oa/richmenu-main.png`（LINE-08 規劃的路徑），由 CODE 複製到後端使用。

## 3. 由 OpenAPI 查得的限制

來源：line/line-openapi `messaging-api.yml`（https://raw.githubusercontent.com/line/line-openapi/main/messaging-api.yml ，2026-10-15 取得；該檔最後修改提交 fa5577c9ea874d2dbd8fadc85a4cb3a1b29d8cbe，2026-09-29）。

| 項目 | 限制 | 位置（yml 行號） |
|---|---|---|
| `chatBarText` | 最多 14 字 | 3339-3342 |
| `name` | 最多 300 字 | 3335-3338 |
| `selected` | boolean，`true` 為預設展開 | 3332-3334 |
| `size.width`、`size.height` | 整數，1 以上 | `RichMenuSize` 3348-3363 |
| `bounds` x、y／width、height | 整數，x、y ≥ 0；width、height ≥ 1 | `RichMenuBounds` 3372-3401 |
| 動作類型 | camera、cameraRoll、clipboard、datetimepicker、location、message、postback、richmenuswitch、uri | `Action` mapping 5127-5136 |
| postback `data` | 最多 300 字 | 5204-5205 |
| richmenuswitch `richMenuAliasId` | 最多 32 字；別名本身要符合 `^[a-z0-9_-]{1,32}$` | 5231-5232；`CreateRichMenuAliasRequest` 3469-3474 |
| 快速回覆按鈕 | 最多 13 個 | `QuickReply` 3855 |
| 圖片上傳 | `POST /v2/bot/richmenu/{richMenuId}/content`，主機 api-data.line.me | 1175-1228 |
| 設為預設選單 | `POST /v2/bot/user/all/richmenu/{richMenuId}` | 1315 |
| 個人選單（第二輪） | `/v2/bot/user/{userId}/richmenu/{richMenuId}` | 1530 |

查不到、一律 **TODO(需查證)**：一份選單最多幾個區域、哪些動作類型可以放在選單區域、動作 `label` 的字數上限、圖片的格式與尺寸上限、預設選單多久後對使用者生效、OA Manager 建立的選單與 API 建立的選單誰優先。本規格只用 `uri`、`postback`、`message` 三種動作。

## 4. 待決與限制

- **網址還不能用**：`dr.nature.smilelife.tw` 目前指向 VPS 暫時頁（docs/ops/edge-cloudflare.md:18）。前台正式發布到這個網址之前，A、B、C 三格會開到暫時頁。上線前要確認三個網址都回 200。
- **知識誌**：前台 /journal/ 目前只有規劃中的範例題目（apps/storefront/lib/site.ts:108「範例題目 · 發布前需法規審核」）。從官方帳號連過去的頁面也算廣告（docs/research/p4-p5-2026-10-13.md:46），所以有文章通過審核、正式發布之前，B 格要不要先換成別的入口，由 Aki 決定。
- **量測**：第二輪看各格點擊（見 rounds.md）。

## 5. 驗收

```bash
node scripts/claims-lint.mjs content/line                        # 0 error(s)
node -e 'JSON.parse(require("fs").readFileSync("content/line/rich-menu.json","utf8"))'
```

提交時另以一次性腳本確認：只有五個頂層欄位；`chatBarText` ≤14 字、`name` ≤300 字；六格整數座標、不重疊、剛好鋪滿 2500 × 1686；動作只用 uri／postback／message；postback `data` ≤300 字且為 `link`、`quiz:start`；uri 全是 https://dr.nature.smilelife.tw；`message` 的文字是 line-replies.json 的關鍵字。

上線後的驗收（CODE 無法代做）：Aki 用測試帳號在手機上看到選單、六格都點得通，截圖存證。
