# 會員登入（P5-01）

程式：`apps/backend/src/lib/auth/config.ts`、`apps/backend/src/modules/line-auth/`；測試：`integration-tests/http/auth.spec.ts`。LINE Login 查證見 [../research/p4-p5-2026-10-13.md](../research/p4-p5-2026-10-13.md) §4。

## 1. 三種登入方式

| 方式 | 啟用條件 | 流程 |
|---|---|---|
| Email＋密碼 | 永遠啟用 | `POST /auth/customer/emailpass/register` → **驗證 Email（§2）** → `POST /store/customers` → `POST /auth/customer/emailpass` |
| Google | `GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET` 同時設定 | `POST /auth/customer/google` 回傳 `location` → 瀏覽器到 Google → 回到前台 `/auth/callback/google?code&state` → 前台呼叫 `POST /auth/customer/google/callback?code&state` 取得 token |
| LINE | `LINE_LOGIN_CHANNEL_ID`、`LINE_LOGIN_CHANNEL_SECRET` 同時設定 | 同上，路徑換成 `line`；前台頁面 `/auth/callback/line` |

只設一半的金鑰、或沒有 `STOREFRONT_URL`，後端會拒絕啟動。後台員工只能用 Email＋密碼登入。

## 2. 建立會員前要先證明 Email 是自己的（審查 auth-2）

Medusa 2.21.2 本身不檢查 Email 是誰的：任何人都能用別人的 Email 建會員，之後那個人用同一個 Email 以訪客身分下單時，訂單（姓名、地址、電話）會被掛到冒用者帳號下。所以 `POST /store/customers` 一定要先過這一關：

| 登入方式 | 怎麼證明 |
|---|---|
| Google | 不用另外驗證：Google 只給已驗證的 Email。直接用 Google 帳號的 Email 建會員（填別的 Email 一樣要驗證） |
| Email＋密碼 | 只能用登入用的那個 Email，而且要驗證 |
| LINE | LINE 不提供 Email（或不保證已驗證），一律要驗證 |

驗證流程（前台 P7 要做）：
1. 帶著登入取得的 token 呼叫 `POST /auth/verification/request`，body `{ "entity_id": "<email>", "entity_type": "email" }`。
2. 系統寄出驗證信，連結是 `STOREFRONT_URL/account/verify-email#code=…`（驗證碼放在 `#` 後面，不會送到伺服器或 Referer）。
3. 前台的 `/account/verify-email` 頁**必須在同一個帳號登入的狀態下**呼叫 `POST /auth/verification/confirm`，body `{ "code": "…" }`。用別的帳號、或沒登入，都會被拒絕（防止有人用自己的帳號申請、騙別人點連結）。在另一台裝置或 LINE 內建瀏覽器打開時，請顧客先登入。
4. 呼叫 `POST /store/customers` 建會員（Email 一律存成小寫）。
5. 呼叫 `POST /auth/token/refresh` 換一個帶會員身分的 token。之後同一個 Google／LINE 帳號登入，會直接回到同一位會員。

限制：同一個帳號 1 分鐘只能申請 1 次；同一個 Email 1 小時最多 5 次（429）。

**還沒有寄信服務（U-09）時**：`EMAIL_PROVIDER` 沒設定，申請驗證會回 503「目前無法寄出驗證信，請改用 Google 登入或稍後再試。」，後台每天出現一則「會員驗證信無法寄出」提醒。**也就是說，正式站在 U-09 完成前，只有 Google 能註冊新會員。**

已經有人用某個 Email 註冊了 Email＋密碼帳號、卻沒驗證時，本人註冊會看到「Identity with email already exists」：前台要提供「忘記密碼」讓本人取回。

同一位顧客用 Email 註冊過、又用 LINE 登入時，系統**不會自動合併**成同一個會員。合併由客服在本人申請後處理（membership.md §3.3）。

## 3. 安全性

- `state` 隨機 64 字元，只能用一次，20 分鐘內有效，存在快取模組。目前用記憶體快取，所以只能跑**一個**後端 server 程序；重啟後，進行到一半的登入要重新開始。
- **後端的 state 只證明「這是我們發出的登入」，不證明「是同一個瀏覽器」**（Medusa 2.21.2 的 callback 沒有 session 可綁）。有人可以自己開始登入、用自己的 LINE 帳號同意，再把回呼網址傳給別人；別人的前台若照轉，就會登入攻擊者的帳號（login CSRF，審查 auth-1）。所以**前台（P7）必須**：
  1. 導去 LINE／Google 之前，從 `location` 取出 `state`，存在 sessionStorage 或短效 httpOnly、SameSite=Lax 的 cookie；
  2. `/auth/callback/{line|google}` 頁只在網址的 `state` 與自己存的相同時，才把 code＋state 轉給後端；不論成功與否都刪掉存的值；不符或沒有時顯示「登入已逾時，請重新開始」；
  3. P7 e2e：在另一個瀏覽器打開同一個回呼網址，前台不得轉送。
- LINE 的 ID token 由 LINE 的 verify 端點驗證（帶我方的 nonce），系統再核對發行者、channel 與 nonce。
- 回呼網址只用設定好的那一個，不接受前台指定。

## 4. Aki 要在後台設定的事（U-17）

1. **LINE Developers**：LINE Login channel 的 Callback URL 設為 `https://dr.nature.smilelife.tw/auth/callback/line`。把官方帳號連結到這個 channel，登入同意畫面才會出現「加入好友」（`bot_prompt=normal`）。
2. **LINE Email 權限**（選擇性）：要取得 Email，需要在 LINE Developers 申請 email 權限；核准後通知 CODE 開啟（`REQUEST_EMAIL`）。`TODO(需查證)`：申請流程與審核時間。
3. **Google Cloud Console**：OAuth 用戶端的已授權重新導向 URI 設為 `https://dr.nature.smilelife.tw/auth/callback/google`。
4. 把四個值寫進主機的 `.env`（不要經過對話）。

## 5. 測試證明不了的事

真的 LINE／Google 同意畫面、Google 的 token 交換與 RS256 驗章（需要 Google 伺服器與真的用戶端）、兩個後台的回呼網址設定。上線前要用真的帳號各登入一次（e2e，P11）。
