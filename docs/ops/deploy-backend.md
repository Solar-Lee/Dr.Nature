# Runbook：後端上線（P12-02～P12-06）

目標：Medusa server＋worker＋Redis 跑在主機（`drn-*` 容器），對外網址 `https://api.dr.nature.smilelife.tw`，資料庫在 Supabase `drn-prod`。守則：[CLAUDE.md](../../CLAUDE.md) §1（只動 `drn` 資源、只新增 `drn.conf`、`nginx -t` 後 `reload`）、§2（正式 `.env` 由 Aki 親手寫到主機）。

`dr.nature.smilelife.tw` 目前是暫時頁（P12-12，已上線）。前台（P7）完成前，它保持暫時頁。

## 0. 只有 Aki 能做的事（擋住上線）

| # | 事項 | 為什麼 |
|---|---|---|
| U-04 | Supabase 組織升級 Pro，或另開一個 Pro 組織；告訴 CODE 用哪個組織建 `drn-prod`（區域建議 `ap-northeast-1` 東京） | 目前組織是 Free 且已有 2 個運作中的專案；免費專案閒置會暫停，正式站不能用 |
| U-05 | Cloudflare 新增 A 記錄：`api.dr.nature` → `151.145.69.134`，**DNS only**（灰雲） | 憑證用 HTTP 驗證；綠界通知要打到主機 |
| — | 在主機寫 `~/drn/.env`（下面 §1 的清單；**不要貼到對話**）；Supabase 的 CA 憑證放 `~/drn/supabase-ca.crt` | 守則 §2 |

## 1. 主機 `~/drn/.env` 清單（名稱見 [ENV.md](../ENV.md)）

| 名稱 | 填法 |
|---|---|
| `DATABASE_URL` | Supabase `drn-prod` → Project Settings → Database → Connection string（**Session pooler 或 Direct**，含 `sslmode=require`；不要用其他專案的資料庫） |
| `DATABASE_SSL_CA_PATH` | `/app/ca/supabase-ca.crt`（compose 會把 `~/drn/supabase-ca.crt` 掛進去；檔案由 Supabase → Database → SSL Configuration 下載） |
| `JWT_SECRET`、`COOKIE_SECRET` | 在主機上各自執行 `openssl rand -hex 32` 產生，直接寫進檔案 |
| `STORE_CORS` | `https://dr.nature.smilelife.tw` |
| `ADMIN_CORS` | `https://api.dr.nature.smilelife.tw` |
| `AUTH_CORS` | `https://dr.nature.smilelife.tw,https://api.dr.nature.smilelife.tw` |
| `MEDUSA_BACKEND_URL` | `https://api.dr.nature.smilelife.tw` |
| `STOREFRONT_URL` | `https://dr.nature.smilelife.tw` |
| `ECPAY_ENV` | `stage`（U-02 正式金鑰到位前一律測試環境，不會收到真錢） |
| `ECPAY_MERCHANT_ID`／`HASH_KEY`／`HASH_IV` | 測試環境：綠界公開測試特店（infra/test-env.sh 的同一組公開值）；正式：U-02 |
| `ECPAY_LOGISTICS_*` | 測試環境：公開 C2C 測試特店；寄件人姓名與手機（U-13） |
| `ECPAY_INVOICE_*` | 先不設（不開發票）；要測時用公開測試特店 |
| **不要設** | `ECPAY_API_BASE_URL`、`ECPAY_LOGISTICS_API_BASE_URL`、`ECPAY_INVOICE_API_BASE_URL`、`LINE_LOGIN_API_BASE_URL`（測試替身用；正式設了會啟動失敗） |
| 選填 | `GOOGLE_OAUTH_*`、`LINE_LOGIN_CHANNEL_*`（U-17 後才設，必須成對） |

`REDIS_URL`、`MEDUSA_WORKER_MODE`、`DISABLE_MEDUSA_ADMIN` 由 compose 設定，`.env` 不必寫。

## 2. CODE 執行的步驟（Aki 完成 §0 之後）

1. **盤點**（P12-01）：與 `docs/private/server-inventory.md` 比對；無 `drn` 重名；3961 未占用；磁碟剩餘 ≥ 4 GB（不足就停手）。
2. **映像**（P12-03）：Mac 上 `docker build -f infra/backend.Dockerfile -t drn-backend:<git-sha> .` → `docker save drn-backend:<sha> | gzip | ssh … 'gunzip | docker load'`。
3. **compose**（P12-02）：`infra/docker-compose.prod.yml` 傳到 `~/drn/`；先只啟 `drn-redis`。
4. **資料庫**（P12-06）：在映像內從 `.medusa/server` 分兩步：`medusa db:migrate --skip-scripts`，再 `medusa db:migrate:scripts`；檢查 `script_migrations` 的 drn-0001～0007 `finished_at` 皆非空（2.21.2 的 db:migrate 在 script 失敗時仍回 0）。
5. **啟動**：`DRN_TAG=<sha> docker compose -f docker-compose.prod.yml up -d drn-backend drn-worker`；`curl -s 127.0.0.1:3961/health` → `OK`。
6. **nginx＋憑證**（P12-04、P12-05）：先在 `drn.conf` 加 `api.dr.nature.smilelife.tw` 的 port 80 區塊（ACME＋轉 HTTPS）→ `nginx -t` → `reload` → `certbot certonly --webroot -w /var/www/drn -d api.dr.nature.smilelife.tw --deploy-hook "systemctl reload nginx"` → 再加 443 區塊（`proxy_pass http://127.0.0.1:3961`，`client_max_body_size` 視上傳需要）→ `nginx -t` → `reload`。
7. **驗收**：`curl -I https://api.dr.nature.smilelife.tw/health` → 200；其他 nginx 檔 md5、容器數、crontab 與部署前一致（P12-09 的 diff）。
8. **之後才做得到的驗證**：綠界測試環境的付款回呼、ATM／超商代碼通知、物流狀態通知（P4-04、P4-05、P4-11 剩下的項目）——這些都需要公開網址，主機上線後就能測。

## 3. 回滾

- 停容器：`docker compose -f docker-compose.prod.yml down`（只動 `drn` 專案；**不要**加 `-v` 以外的全域參數，不 prune）。
- 換回上一版：`DRN_TAG=<上一版 sha> docker compose … up -d`（先停舊 worker）。
- nginx：把 `drn.conf` 換回上一版 → `nginx -t` → `reload`。
- 資料庫：Supabase 時間點還原（Pro 方案才有）。
