# 環境變數白名單（只列名稱，永不寫值）

規則：程式只能讀這裡列出的名稱。要新增名稱，先在本檔加一列（用途＋來源文件），同一個提交再改程式。值由 Aki 寫進主機或 Vercel／Supabase 後台，不經過對話、不入版控。`.env.example` 只放名稱與假值。

標記：`🔒` 機密（只在伺服器端）；`🌐` 會被打包進瀏覽器（`NEXT_PUBLIC_*`，不可放機密）；`TODO(需查證)` 為尚未對官方文件確認的項目。

## apps/backend（Medusa v2，Mac mini 容器 `drn-backend`／`drn-worker`）

| 名稱 | 用途 | 來源 |
|---|---|---|
| `DATABASE_URL` 🔒 | Postgres 連線字串。正式環境是自架的 `drn-postgres`（`postgres://drn:<密碼>@drn-postgres:5432/drn?sslmode=disable`，只在 `drn_net` 內部；A7。`sslmode=disable` 必要：Medusa 遷移用的鎖連線對非 localhost 預設開 SSL，見 drn-gen-env.sh）。不得帶 `host`／`hostaddr` 查詢參數（會被拒絕啟動，P12-14） | Medusa deployment docs |
| `DATABASE_SSL_CA_PATH` | 經網路連線的資料庫的 CA 憑證檔路徑；主機不是本機（localhost／127.0.0.1／::1）也不是精確字串 `drn-postgres` 時必填，缺少則啟動失敗（fail closed）。正式環境用 `drn-postgres` 時不設 | src/lib/database/config.ts（P3 審查 F1、P12-14） |
| `REDIS_URL` 🔒 | `drn-redis`（僅 `drn_net` 內部） | Medusa deployment docs |
| `JWT_SECRET` 🔒 | Medusa 驗證 | Medusa deployment docs |
| `COOKIE_SECRET` 🔒 | Medusa session | Medusa deployment docs |
| `STORE_CORS` | 前台網域 | medusa-config |
| `ADMIN_CORS` | 後台網域 | medusa-config |
| `AUTH_CORS` | 前台＋後台網域 | medusa-config |
| `MEDUSA_BACKEND_URL` | 後端對外網址（`https://<API_HOST>`，主機名稱依 D12 由 Aki 定）；也是上傳檔公開網址的來源（`<網址>/static`，正式環境缺少則啟動失敗，P12-15） | medusa-config |
| `MEDUSA_WORKER_MODE` | `server`／`worker` | Medusa worker mode docs |
| `DISABLE_MEDUSA_ADMIN` | worker 容器設 `true` | Medusa worker mode docs |
| `ECPAY_ENV` | `stage`／`prod`；未設定時不註冊 ECPay（正式環境 drn-0005 會因此失敗，不會靜默） | 本專案定義 |
| `ECPAY_API_BASE_URL` | 僅測試／開發：QueryTradeInfo 改打本機替身；`ECPAY_ENV=prod` 時設定會啟動失敗 | 本專案定義（P4-03） |
| `STOREFRONT_URL` | 前台網址（後端產生 ECPay OrderResultURL／ClientBackURL 用） | 本專案定義（P4-03） |
| `ECPAY_ACCEPT_SIMULATED_PAYMENTS` | 僅 `ECPAY_ENV=stage`：`true` 時把綠界後台「模擬付款」視為已付款，用於 ATM／超商代碼端到端測試；prod 設定會啟動失敗 | 本專案定義（P4-04） |
| `ECPAY_MERCHANT_ID` 🔒 | 綠界金流特店編號 | ECPay 文件 |
| `ECPAY_HASH_KEY` 🔒 | 綠界金流 HashKey | ECPay 文件 |
| `ECPAY_HASH_IV` 🔒 | 綠界金流 HashIV | ECPay 文件 |
| `ECPAY_AUTO_REFUND` | `true` 才啟用信用卡自動退款（CreditDetail，僅正式環境；預設關閉，須先以一筆真實小額交易驗證，DEV_PLAN P4-08）；開啟時信用卡建單帶 `NeedExtraPaidInfo=Y` | 本專案定義（P4-08） |
| `ECPAY_CREDIT_CHECK_CODE` 🔒 | 信用卡明細查詢的商家檢查碼（廠商後台 信用卡收單 > 信用卡授權資訊）；`ECPAY_AUTO_REFUND=true` 時必填 | developers.ecpay.com.tw/2894/ |
| `ECPAY_UNPAID_CANCEL_MINUTES` | 信用卡訂單未付款幾分鐘後自動取消（預設 180、最小 60；待 Aki 決定，DEV_PLAN P4-09） | 本專案定義（P4-09） |
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
| `LINE_LOGIN_CHANNEL_ID` | LINE Login（會員登入）；與 SECRET 必須同時設定，否則啟動失敗。Callback：`STOREFRONT_URL` + `/auth/callback/line` | LINE Developers |
| `LINE_LOGIN_CHANNEL_SECRET` 🔒 | LINE Login | LINE Developers |
| `LINE_LOGIN_API_BASE_URL` | 僅測試／開發：LINE token／verify 改打本機替身；`NODE_ENV=production` 時設定會啟動失敗 | 本專案定義（P5-01） |
| `GOOGLE_OAUTH_CLIENT_ID` | Google 登入；與 SECRET 必須同時設定，否則啟動失敗。Callback：`STOREFRONT_URL` + `/auth/callback/google` | Google Cloud Console |
| `GOOGLE_OAUTH_CLIENT_SECRET` 🔒 | Google 登入 | Google Cloud Console |
| `FILE_S3_BUCKET` | 商品圖／上傳檔的 S3 相容儲存。**MVP 未使用**：A7 改用 file-local＋資料卷 `drn_uploads`（P12-15）；前台上線前再評估 | Medusa S3 file provider |
| `FILE_S3_REGION` | 同上 | 同上 |
| `FILE_S3_ENDPOINT` | 同上 | 同上 |
| `FILE_S3_ACCESS_KEY_ID` 🔒 | 同上 | 同上 |
| `FILE_S3_SECRET_ACCESS_KEY` 🔒 | 同上 | 同上 |
| `FILE_S3_PUBLIC_URL` | 同上 | 同上 |
| `AFFILIATE_PORTAL_HMAC_SECRET` 🔒 | 分潤夥伴免登入唯讀成效頁的簽章 | 本專案定義 |
| `INTEGRATION_API_TOKEN` 🔒 | 團購系統（tuangou-admin）讀取訂單／GMV 的唯讀權杖 | 本專案定義 |
| `EMAIL_PROVIDER` | 寄信服務（會員 Email 驗證信；之後含訂單確認、出貨通知）。未設定＝不寄信（Email／LINE 註冊回 503，fail closed）；`log`＝僅開發／測試，把驗證連結寫進日誌（正式環境設定會啟動失敗）；其他值在 U-09 選定並實作前會啟動失敗 | 本專案定義（P5-01 審查 auth-2）；TODO(需查證：Aki 選定寄信服務 U-09) |
| `MEDUSA_DISABLE_TELEMETRY` | `true`：不送 Medusa 匿名遙測（少一條出站連線，D11） | @medusajs/telemetry 2.21.2 store.js:21 |
| `NODE_ENV` | `production`／`development`／`test`；映像固定 `production`；Medusa CLI 未設時預設 `development` | @medusajs/cli 2.21.2 create-cli.js:182 |
| `POSTGRES_USER` | `drn-postgres` 容器初始化的角色名（`drn`）；compose 用 `${POSTGRES_USER:?}` 讀取 | docker-library postgres（docker-entrypoint.sh） |
| `POSTGRES_PASSWORD` 🔒 | `drn-postgres` 的角色密碼；由 `drn-gen-env.sh` 以 `openssl rand` 產生，同時寫進 `DATABASE_URL` | 同上 |
| `POSTGRES_DB` | `drn-postgres` 初始資料庫名（`drn`） | 同上 |
| `TUNNEL_TOKEN` 🔒 | Cloudflare Tunnel 的 token，只放 `~/drn/tunnel.env`（600），由 `drn-cloudflared` 的 env_file 載入；永不入版控 | Cloudflare docs：tunnel run parameters（`--token` 對應 `TUNNEL_TOKEN`） |

## 主機腳本（Mac mini，`~/drn/host.env` 與 LaunchAgent；不進容器）

| 名稱 | 用途 | 來源 |
|---|---|---|
| `DOCKER_HOST` | `drn-docker` 包裝固定指向 Docker Desktop 的 socket（`~/.docker/run/docker.sock`），不依賴 docker context | Docker CLI reference（environment variables） |
| `DOCKER_CONTEXT` | `drn-docker` 包裝一律 `unset`：這個變數會覆蓋 `DOCKER_HOST`（Docker CLI reference），不能讓外部 shell 的設定把 drn 指令導到別的引擎 | Docker CLI reference（environment variables） |
| `DOCKER_CONFIG` | `drn-docker` 包裝固定指向 `~/drn/docker-config`（只含 `cliPluginsExtraDirs`，沒有 `credsStore`），不碰 Aki 的 `~/.docker/config.json` | 同上 |
| `DRN_HC_HEARTBEAT_URL` 🔒 | Healthchecks.io `drn-heartbeat` 的 ping 網址（monitor 每 5 分鐘） | 本專案定義（P12-20） |
| `DRN_HC_ALERT_URL` 🔒 | Healthchecks.io `drn-ecpay-alert`（ALERT 掃描） | 本專案定義（P12-20） |
| `DRN_HC_ACCESS_URL` 🔒 | Healthchecks.io `drn-access`（Access 漂移，每小時） | 本專案定義（P12-20） |
| `DRN_HC_BACKUP_URL` 🔒 | Healthchecks.io `drn-backup`（每日備份） | 本專案定義（P12-08） |
| `DRN_HC_DRILL_URL` 🔒 | Healthchecks.io `drn-restore-check`（每週還原演練） | 本專案定義（P12-21） |
| `DRN_R2_REMOTE` | rclone remote 加 bucket（`drnr2:drn-backups`）；空值＝不做異地備份（`offsite-required` 存在時算失敗） | 本專案定義（P12-08） |

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
