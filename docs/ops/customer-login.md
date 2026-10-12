# 會員登入（P5-01）

程式：`apps/backend/src/lib/auth/config.ts`、`apps/backend/src/modules/line-auth/`；測試：`integration-tests/http/auth.spec.ts`。LINE Login 查證見 [../research/p4-p5-2026-10-13.md](../research/p4-p5-2026-10-13.md) §4。

## 1. 三種登入方式

| 方式 | 啟用條件 | 流程 |
|---|---|---|
| Email＋密碼 | 永遠啟用 | `POST /auth/customer/emailpass/register` → `POST /store/customers` → `POST /auth/customer/emailpass` |
| Google | `GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET` 同時設定 | `POST /auth/customer/google` 回傳 `location` → 瀏覽器到 Google → 回到前台 `/auth/callback/google?code&state` → 前台呼叫 `POST /auth/customer/google/callback?code&state` 取得 token |
| LINE | `LINE_LOGIN_CHANNEL_ID`、`LINE_LOGIN_CHANNEL_SECRET` 同時設定 | 同上，路徑換成 `line`；前台頁面 `/auth/callback/line` |

只設一半的金鑰、或沒有 `STOREFRONT_URL`，後端會拒絕啟動。後台員工只能用 Email＋密碼登入。

## 2. 第一次用 Google／LINE 登入（前台 P7 要做）

1. callback 取得的 token 還沒有對應會員（`actor_id` 是空的）。
2. 前台呼叫 `POST /store/customers`（帶這個 token）建立會員。**Email 必填**（Medusa 2.21.2 的規定）。LINE 不提供 Email，所以前台要先請顧客填 Email。
3. 再呼叫 `POST /auth/token/refresh` 換一個帶會員身分的 token。
4. 之後同一個 Google／LINE 帳號登入，會直接回到同一位會員。

同一位顧客用 Email 註冊過、又用 LINE 登入時，系統**不會自動合併**成同一個會員。合併由客服在本人申請後處理（membership.md §3.3）。

## 3. 安全性

- `state` 隨機 64 字元，只能用一次，20 分鐘內有效，存在快取模組。目前用記憶體快取，所以只能跑**一個**後端 server 程序；重啟後，進行到一半的登入要重新開始。
- LINE 的 ID token 由 LINE 的 verify 端點驗證（帶我方的 nonce），系統再核對發行者、channel 與 nonce。
- 回呼網址只用設定好的那一個，不接受前台指定。

## 4. Aki 要在後台設定的事（U-17）

1. **LINE Developers**：LINE Login channel 的 Callback URL 設為 `https://dr.nature.smilelife.tw/auth/callback/line`。把官方帳號連結到這個 channel，登入同意畫面才會出現「加入好友」（`bot_prompt=normal`）。
2. **LINE Email 權限**（選擇性）：要取得 Email，需要在 LINE Developers 申請 email 權限；核准後通知 CODE 開啟（`REQUEST_EMAIL`）。`TODO(需查證)`：申請流程與審核時間。
3. **Google Cloud Console**：OAuth 用戶端的已授權重新導向 URI 設為 `https://dr.nature.smilelife.tw/auth/callback/google`。
4. 把四個值寫進主機的 `.env`（不要經過對話）。

## 5. 測試證明不了的事

真的 LINE／Google 同意畫面、Google 的 token 交換與 RS256 驗章（需要 Google 伺服器與真的用戶端）、兩個後台的回呼網址設定。上線前要用真的帳號各登入一次（e2e，P11）。
