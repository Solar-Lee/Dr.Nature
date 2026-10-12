# 環境變數白名單（只列名稱，永不寫值）

規則：程式只能讀這裡列出的名稱。要新增名稱，先在本檔加一列（用途＋來源文件），同一個提交再改程式。值由 Aki 寫進主機或 Vercel／Supabase 後台，不經過對話、不入版控。`.env.example` 只放名稱與假值。

標記：`🔒` 機密（只在伺服器端）；`🌐` 會被打包進瀏覽器（`NEXT_PUBLIC_*`，不可放機密）；`TODO(需查證)` 為尚未對官方文件確認的項目。

## apps/backend（Medusa v2，VPS 容器 `drn-backend`／`drn-worker`）

| 名稱 | 用途 | 來源 |
|---|---|---|
| `DATABASE_URL` 🔒 | 專屬 Supabase 專案的 Postgres 連線字串（不可共用其他專案的資料庫） | Medusa deployment docs |
| `DATABASE_SSL_CA_PATH` | 非本機資料庫（Supabase）的 CA 憑證檔路徑；有設 DATABASE_URL 且非 localhost 時必填，缺少則啟動失敗（fail closed） | medusa-config（P3 審查 F1） |
| `REDIS_URL` 🔒 | `drn-redis`（僅 `drn_net` 內部） | Medusa deployment docs |
| `JWT_SECRET` 🔒 | Medusa 驗證 | Medusa deployment docs |
| `COOKIE_SECRET` 🔒 | Medusa session | Medusa deployment docs |
| `STORE_CORS` | 前台網域 | medusa-config |
| `ADMIN_CORS` | 後台網域 | medusa-config |
| `AUTH_CORS` | 前台＋後台網域 | medusa-config |
| `MEDUSA_BACKEND_URL` | 後端對外網址（`https://api.dr.nature.smilelife.tw`，待 DNS） | medusa-config |
| `MEDUSA_WORKER_MODE` | `server`／`worker` | Medusa worker mode docs |
| `DISABLE_MEDUSA_ADMIN` | worker 容器設 `true` | Medusa worker mode docs |
| `ECPAY_ENV` | `stage`／`prod`；未設定時不註冊 ECPay（正式環境 drn-0005 會因此失敗，不會靜默） | 本專案定義 |
| `ECPAY_API_BASE_URL` | 僅測試／開發：QueryTradeInfo 改打本機替身；`ECPAY_ENV=prod` 時設定會啟動失敗 | 本專案定義（P4-03） |
| `STOREFRONT_URL` | 前台網址（後端產生 ECPay OrderResultURL／ClientBackURL 用） | 本專案定義（P4-03） |
| `ECPAY_ACCEPT_SIMULATED_PAYMENTS` | 僅 `ECPAY_ENV=stage`：`true` 時把綠界後台「模擬付款」視為已付款，用於 ATM／超商代碼端到端測試；prod 設定會啟動失敗 | 本專案定義（P4-04） |
| `ECPAY_MERCHANT_ID` 🔒 | 綠界金流特店編號 | ECPay 文件 |
| `ECPAY_HASH_KEY` 🔒 | 綠界金流 HashKey | ECPay 文件 |
| `ECPAY_HASH_IV` 🔒 | 綠界金流 HashIV | ECPay 文件 |
| `ECPAY_LOGISTICS_MERCHANT_ID` 🔒 | 綠界物流 | TODO(需查證：物流與金流是否共用同組金鑰) |
| `ECPAY_LOGISTICS_HASH_KEY` 🔒 | 綠界物流 | 同上 |
| `ECPAY_LOGISTICS_HASH_IV` 🔒 | 綠界物流 | 同上 |
| `ECPAY_LOGISTICS_CONTRACT` | `C2C`（店到店，預設，Aki 2026-10-13 決定）／`B2C`（大宗寄倉） | 本專案定義（P4-05） |
| `ECPAY_LOGISTICS_SENDER_NAME` | 寄件人**個人**姓名（C2C 規定，2-5 個中文字） | ECPay Express/Create（P4-05） |
| `ECPAY_LOGISTICS_SENDER_CELLPHONE` | 寄件人手機 09xxxxxxxx | 同上 |
| `ECPAY_LOGISTICS_SENDER_ZIPCODE` | 宅配寄件郵遞區號（僅宅配需要） | 同上 |
| `ECPAY_LOGISTICS_SENDER_ADDRESS` | 宅配寄件地址（僅宅配需要） | 同上 |
| `ECPAY_LOGISTICS_API_BASE_URL` | 僅測試／開發：Express/Create 改打本機替身；`ECPAY_ENV=prod` 時設定會啟動失敗 | 本專案定義（P4-05） |
| `ECPAY_INVOICE_MERCHANT_ID` 🔒 | 綠界電子發票（與金流、物流各自獨立；測試環境為公開 2000132，`ECPAY_ENV=prod` 時拒用）。未設定＝不開立發票、不影響下單 | developers.ecpay.com.tw/7849/（INV-05、INV-06） |
| `ECPAY_INVOICE_HASH_KEY` 🔒 | 綠界電子發票 AES 金鑰（16 字元） | 同上 |
| `ECPAY_INVOICE_HASH_IV` 🔒 | 綠界電子發票 AES IV（16 字元） | 同上 |
| `ECPAY_INVOICE_API_BASE_URL` | 僅測試／開發：發票 API 改打本機替身；`ECPAY_ENV=prod` 時設定會啟動失敗 | 本專案定義（P4-06） |
| `SMS_PROVIDER` | `mitake`／`every8d`／`log`（`log` 只寫日誌不發送，開發預設） | 本專案定義 |
| `SMS_USERNAME` 🔒 | 簡訊商帳號 | TODO(需查證：依選定簡訊商) |
| `SMS_PASSWORD` 🔒 | 簡訊商密碼 | 同上 |
| `LINE_LOGIN_CHANNEL_ID` | LINE Login（會員登入） | LINE Developers |
| `LINE_LOGIN_CHANNEL_SECRET` 🔒 | LINE Login | LINE Developers |
| `GOOGLE_OAUTH_CLIENT_ID` | Google 登入 | Google Cloud Console |
| `GOOGLE_OAUTH_CLIENT_SECRET` 🔒 | Google 登入 | Google Cloud Console |
| `FILE_S3_BUCKET` | 商品圖／上傳檔（Supabase Storage S3 相容端點，避免占用 VPS 磁碟） | Medusa S3 file provider |
| `FILE_S3_REGION` | 同上 | 同上 |
| `FILE_S3_ENDPOINT` | 同上 | 同上 |
| `FILE_S3_ACCESS_KEY_ID` 🔒 | 同上 | 同上 |
| `FILE_S3_SECRET_ACCESS_KEY` 🔒 | 同上 | 同上 |
| `FILE_S3_PUBLIC_URL` | 同上 | 同上 |
| `AFFILIATE_PORTAL_HMAC_SECRET` 🔒 | 分潤夥伴免登入唯讀成效頁的簽章 | 本專案定義 |
| `INTEGRATION_API_TOKEN` 🔒 | 團購系統（tuangou-admin）讀取訂單／GMV 的唯讀權杖 | 本專案定義 |
| `EMAIL_PROVIDER` | 交易信（訂單確認、出貨通知）服務 | TODO(需查證：Aki 選定寄信服務) |

## apps/storefront（Next.js，Vercel）

| 名稱 | 用途 |
|---|---|
| `NEXT_PUBLIC_MEDUSA_BACKEND_URL` 🌐 | 後端網址 |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` 🌐 | Medusa publishable API key（設計上公開） |
| `NEXT_PUBLIC_BASE_URL` 🌐 | `https://dr.nature.smilelife.tw` |
| `NEXT_PUBLIC_DEFAULT_REGION` 🌐 | `tw` |
| `NEXT_PUBLIC_GTM_ID` 🌐 | Google Tag Manager |
| `NEXT_PUBLIC_GA4_ID` 🌐 | GA4 |
| `NEXT_PUBLIC_META_PIXEL_ID` 🌐 | Meta Pixel |
| `META_CAPI_ACCESS_TOKEN` 🔒 | Meta Conversions API（伺服器端） |
| `REVALIDATE_SECRET` 🔒 | 後台更新商品／文章時觸發 ISR 重新產生 |

## 測試／CI

| 名稱 | 用途 |
|---|---|
| `E2E_BASE_URL` | Playwright 目標站（本機／staging／正式） |
| `E2E_ALLOW_WRITES` | `1` 才允許 e2e 建立訂單；正式站一律不設 |
| `DB_HOST` | 後端整合測試的 Postgres 主機（@medusajs/test-utils 2.21.2 只讀這組，不讀 DATABASE_URL；須含 `localhost`） |
| `DB_PORT` | 同上 |
| `DB_USERNAME` | 同上 |
| `DB_PASSWORD` | 同上（本機開發容器的非機密密碼） |
