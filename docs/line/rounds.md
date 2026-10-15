# LINE 官方帳號：三輪迭代與量測

範圍：Aki 要求 LINE 客服做三輪、可以量測的迭代。三輪的任務來源是 2026-10-14 審計的 LINE-16（第一輪）、LINE-17（第二輪）、LINE-13（第三輪）。這裡的「三輪迭代」是上線後的產品迭代；人設文字的三輪審查是另一件事，記在 [content/line/persona.md](../../content/line/persona.md) 第 0 節。

相關檔案：回覆文字 [apps/backend/src/data/line-replies.json](../../apps/backend/src/data/line-replies.json)（出處見 [replies-sources.md](replies-sources.md)）、圖文選單 [content/line/rich-menu.md](../../content/line/rich-menu.md)、小測驗 [content/line/quiz.json](../../content/line/quiz.json)。

## 共同規則

- 每一輪開始前，把該輪的驗收指令、預期數字與回滾方式寫進 docs/DEV_PLAN.md 的任務列（CLAUDE.md §4）；結束時把實測數字與日期寫回同一列。
- 量測只讀正式主機的日誌，一律經 `~/drn/bin/drn-docker`（CLAUDE.md §1b 第 2 條）；不讀 `.env`，不執行 `docker exec … env`。
- 只統計次數。日誌與報表不放 LINE userId、訊息全文、電話或地址。
- 改 line-replies.json、quiz.json、rich-menu.json 後，都要跑 `node scripts/claims-lint.mjs content/line apps/backend/src/data/line-replies.json`（0 error）與 `pnpm test`（scripts/test-all.sh）（離場碼 0）。
- 推播會用到每月訊息額度；額度依 Aki 的官方帳號方案而定：TODO(需查證)（LINE 官方帳號方案頁）。

## 需要後端日誌提供的欄位（交給後端車道）

第一輪的數字要從日誌算出來。webhook 處理器每處理一個事件，請寫一行 JSON（欄位名稱以後端實作為準，定案後回填本節）：

| 欄位 | 值 | 用途 |
|---|---|---|
| `path` | webhook 路由。審計 LINE-16 草案是 `/hooks/line/webhook`；實際路徑以 LN-06 的實作為準：TODO(需查證) | 篩選 LINE 事件 |
| `status` | HTTP 狀態碼（驗章失敗為 4xx） | 驗章失敗數 |
| `line_event` | `follow`、`unfollow`、`message`、`postback` | 事件分布 |
| `line_route` | 命中的意圖 id、`fallback`、`handoff`、`quiz`、`link` | 命中率 |
| `line_postback` | postback 的 data（例如 `quiz:3:a`、`link`），只記 data，不記使用者 | 選單與小測驗點擊 |
| `line_push` | 推播則數（只在主動推播時寫） | 額度 |

未命中的原文要不要記、記多久、要不要遮掉數字，牽涉個資：**需 Aki 決定**，並寫進隱私權政策（P7-10）後才能開始記。決定前，第一輪的關鍵字只依 Aki 在 LINE Official Account Manager 聊天室看到的提問人工補充。

## 第一輪：FAQ 命中率（LINE-16，上線後第 7 天）

- **開始條件**：LINE-14 webhook 切換完成、LN-03 人設第 3 輪簽核、line-replies.json 上線滿 7 天。
- **量測**（CODE 在 Mac mini 上執行，指令以 LN-06 的實際欄位為準）：
  ```bash
  ~/drn/bin/drn-docker logs --since 168h drn-backend 2>&1 \
    | jq -rR 'fromjson? | select(.path=="/hooks/line/webhook") | .status' | sort | uniq -c
  ~/drn/bin/drn-docker logs --since 168h drn-backend 2>&1 \
    | jq -rR 'fromjson? | select(.line_event=="message") | .line_route' | sort | uniq -c
  ~/drn/bin/drn-docker logs --since 168h drn-backend 2>&1 \
    | jq -rR 'fromjson? | select(.line_event=="postback") | .line_postback' | sort | uniq -c
  ```
- **指標與門檻**（來源：審計 LINE-16）：

  | 指標 | 算法 | 門檻 |
  |---|---|---|
  | 合法流量的驗章失敗 | `status` 為 4xx 且來源是 LINE 的次數 | 0 |
  | FAQ 未命中率 | `line_route=fallback` ÷ 全部 `message` 事件 | ≤30% |
  | 推播月累計 | `line_push` 加總 | ≤150 則（留 50 則給綁定通知） |
  | 綁定成功數 | LN-05 上線後的綁定紀錄 | 只記錄，不設門檻 |

  另外記錄、不設門檻：`handoff` 次數；小測驗完成率（`quiz:5:*` 次數 ÷ `quiz:start` 次數）；圖文選單 `link` 次數。
- **調整**：依未命中的提問補關鍵字或新意圖（意圖總數上限 14，超過就合併）。每個新事實先寫進 replies-sources.md 的出處欄。
- **驗收**：DEV_PLAN 新列寫上四個數字與量測日期；claims-lint 0 error；`pnpm test`（scripts/test-all.sh） 離場碼 0。
- **回滾**：line-replies.json 回到前一個提交。

## 第二輪：雙頁圖文選單與個人選單（LINE-17）

- **開始條件**：第一輪完成；LN-05 會員綁定上線；DESIGN 交出第二張選單圖（尺寸同第一張，規格見 rich-menu.md 第 2 節）。
- **做法**：
  - 建兩份選單與兩個別名 `richmenu-shop`、`richmenu-member`（別名須符合 `^[a-z0-9_-]{1,32}$`，line-openapi `CreateRichMenuAliasRequest`，messaging-api.yml 3469-3474）。兩份各留一格用 `richmenuswitch` 互切（動作類型見 yml 5127-5136；`richMenuAliasId` 最多 32 字，yml 5231-5232）。
  - 綁定成功後，對該使用者設定會員選單：`POST /v2/bot/user/{userId}/richmenu/{richMenuId}`（yml 1530）；解除綁定時移除：`DELETE /v2/bot/user/{userId}/richmenu`（yml 1495，operationId unlinkRichMenuIdFromUser）。
  - 會員頁的格子沿用 line-replies.json 的關鍵字與 postback，不另寫新文字；需要新文字時先改 line-replies.json 並過 lint。
- **量測**：

  | 指標 | 算法 | 判讀 |
  |---|---|---|
  | 各格點擊 | postback 與 `richmenuswitch` 的 data 次數；uri 格看 `utm_content` 的存取次數 | 和第一輪同期比較，找出沒人點的格子 |
  | 綁定數變化 | 第二輪 7 天的新增綁定 ÷ 第一輪 7 天 | 只記錄 |
  | 會員選單套用錯誤 | 設定或移除個人選單的 API 非 200 次數 | 0 |
- **驗收**：後端 `test:integration:http` 離場碼 0（替身驗證別名建立與個人選單的設定、移除）；Aki 在手機上確認切換正常、綁定後選單立即換成會員頁（CODE 無法代做）。
- **回滾**：預設選單設回第一輪的 `drn-main-v1`；移除所有個人選單。

## 第三輪：LIFF 會員卡與訂單頁（LINE-13）

- **開始條件**：第二輪完成；P7-06 會員中心上線；G7 開賣；Aki 在 LINE Login channel 建立 LIFF app（U-17 擴充）。
- **做法**：
  - Aki 建 LIFF，把 LIFF ID（公開值）交給 CODE。前台變數名稱要先補進 docs/ENV.md 白名單才能用（CLAUDE.md §2）。
  - 安裝 LIFF SDK 前先 `npm view @line/liff version`，結果寫進提交訊息（CLAUDE.md §3 第 1 條）。
  - 後端用 LINE Login 的 ID token 驗證端點 `POST https://api.line.me/oauth2/v2.1/verify` 驗證（docs/research/p4-p5-2026-10-13.md:38），沿用 line-auth 的身分對應。
  - LIFF 頁只顯示會員等級與最近訂單，訂單資料的遮罩規則與 order-privacy 相同。
- **量測**：

  | 指標 | 算法 | 門檻 |
  |---|---|---|
  | ID token 驗證失敗（合法開啟） | 驗證端點回非 200 的次數 | 0 |
  | LIFF 開啟次數 | LIFF 頁的請求次數 | 只記錄 |
  | 經 LIFF 查訂單後仍轉真人的比例 | 開過 LIFF 的使用者當天又觸發 `handoff` 的次數 ÷ LIFF 開啟次數（只算次數，不串個人） | 和第二輪的訂單類 `handoff` 比較，應該下降 |
- **驗收**：`test:unit`（aud、iss 不符或過期 → 401）與前台 build 離場碼 0；Aki 在 LINE App 開 LIFF，看到自己的等級（CODE 無法代做）。
- **回滾**：Aki 刪除 LIFF app；`git revert`。

## 不能證明什麼

- 本檔的門檻只能用正式日誌驗證；本機與替身測試只能證明程式路徑，不能證明真實使用者的命中率。
- LINE 端的行為（預設選單多久生效、replyToken 規則、OA Manager 聊天與 webhook 能否並用）都還是 TODO(需查證)，見 persona.md §5 與 rich-menu.md 第 3 節。
