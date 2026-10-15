# LINE 官方帳號 webhook（LINE-02～LINE-07）

G3 ③（Aki 2026-10-15）：官方帳號的 webhook 由 Medusa 接收，驗章後原樣轉送給團購招商機器人 `drnature_bot`，同時由 Medusa 自動回覆一對一聊天。

```
LINE Platform ──POST──▶ https://<API_HOST>/hooks/line/webhook   (src/api/hooks/line/webhook/route.ts)
                          1. 未設定 LINE_OA_CHANNEL_SECRET → 503
                          2. x-line-signature 對「原始 body」驗章失敗 → 401（只記 client_ip）
                          3. 設了 LINE_OA_FORWARD_URL → 原始 bytes＋原 x-line-signature＋content-type
                             轉送給 drnature_bot（不等待、5 秒逾時、不重試）
                          4. 解析 events；同一 webhookEventId 已處理過（重送）→ 略過
                          5. 先回 200 {}，再逐一處理事件
                          6. 一對一聊天（source.type = user、mode = active）才自動回覆（reply API，免費）
```

## 環境變數（名稱見 docs/ENV.md；值由 Aki 寫進 `~/drn/.env`）

| 名稱 | 正式環境 |
|---|---|
| `LINE_OA_CHANNEL_ID` | Messaging API channel ID。和 SECRET 都設定才會回覆；缺一個＝照樣回 200 但不回覆（日誌 `not sent`） |
| `LINE_OA_CHANNEL_SECRET` 🔒 | 同一 channel 的 channel secret（U-01 輪替後的值）。未設定＝webhook 回 503 |
| `LINE_OA_FORWARD_URL` | drnature_bot 原本的 webhook 網址。未設定＝不轉送 |
| `LINE_OA_API_BASE_URL` | **不設**。只給測試替身用；`NODE_ENV=production` 時設定會啟動失敗 |

## 上線步驟（依序；每一步都由 Aki 核准）

1. Aki 把上表三個值寫進 `~/drn/.env`，照 docs/ops/deploy-backend.md 重新部署。
2. 邊緣放行 `/hooks/line/webhook`：目前 tunnel 的 `public` ingress 與 Access 應用 `drn-api-public` 只放行 `/hooks/ecpay/*` 與 `/health`（docs/ops/edge-cloudflare.md）。要另開任務改 `infra/host/drn-tunnel-setup.sh` 的 ingress 規則，並由 Aki 在 Cloudflare 後台把路徑加進 `drn-api-public`（Bypass）。TODO(需查證)：WAF 的 `drn-ecpay-callback-skip` 是否也要涵蓋這個路徑，依 Browser Integrity Check 對 LINE 來源的實測決定。
3. 確認邊緣：`curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{"events":[]}' https://<API_HOST>/hooks/line/webhook` → `401`（沒有簽章；看到 401 代表請求有到 Medusa，而不是被 Access 擋下的 302 或 tunnel 的 404）。
4. LINE Developers Console：在這個 Messaging API channel 把 Webhook URL 改成 `https://<API_HOST>/hooks/line/webhook`，按 **Verify**（LINE 送空的 events 陣列，應回 200；developers.line.biz/en/docs/messaging-api/verify-webhook-url/）。
5. 用測試帳號加好友 → 應收到問候訊息；傳「真人」→ 應收到真人客服說明；drnature_bot 端應照常收到同一則訊息。

## 日誌標籤（不含訊息內容、userId、簽章、token）

- `[LINE-WEBHOOK] event <type> <webhookEventId>`、`replied <kind> to <id>`、`<kind> reply for <id> not sent: …`
- `[LINE-WEBHOOK] signature rejected (client_ip=…)`：連續出現代表有人在試打，或 secret 不一致（U-01 輪替後 `.env` 沒更新）。
- `[LINE-WEBHOOK] line-replies: …; using the built-in minimal replies`：`src/data/line-replies.json` 不符合格式，正在用內建的最小回覆。
- `[LINE-FORWARD] failed: status N | network error | timeout | … not an http(s) URL`：drnature_bot 沒收到這一則（不會重送）。
- `[LINE-PUSH] userId_hash=… count=n`：每次推播（計費），月底對照方案額度。

## 回滾

- 只停轉送：清空 `LINE_OA_FORWARD_URL` 後重新部署。
- 整條退回 G3 ①：LINE Developers Console 的 Webhook URL 改回 drnature_bot 原址並按 Verify；之後 Medusa 這條路由不會再收到請求（程式不必回退）。
- 程式回退：`git revert` LINE-04～LINE-07 的提交。

## 測試證明了什麼、不能證明什麼

- 單元（`src/lib/line/__tests__/`）：驗章（含 LINE 官方範例）、token 快取與重簽、reply／push、重試鍵、轉送原始 bytes、回覆內容的格式檢查與關鍵字比對。
- 整合（`integration-tests/http/line-webhook.spec.ts`）：路由的 503／401／200、原始 bytes、重送去重、自動回覆送到本機 LINE 替身、群組不回覆、轉送給慢速替身時 200 不被拖慢。替身都用作業系統指派的 port，不佔 56390-56393。
- 不能證明：LINE 正式伺服器打得到這個網址（邊緣設定）、正式 channel secret 正確、drnature_bot 接受轉送的請求、正式 API 的回覆與推播。這些在上線步驟 3～5 由 Aki 確認。
