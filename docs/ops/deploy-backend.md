# Runbook：後端正式站（Mac mini M4，Docker Desktop）

版本：2026-10-14（取代 VPS＋Supabase 版）。守則：[CLAUDE.md](../../CLAUDE.md) §1b（Mac mini，草案待核准）、§2（`.env` 由 Aki 親手產生，不經對話）。研究依據：[research/mac-mini-deploy-2026-10-13.md](../research/mac-mini-deploy-2026-10-13.md)。任務列與狀態：[DEV_PLAN.md](../DEV_PLAN.md) P12。

MVP 範圍（A7）：只上後端——Medusa API＋管理後台 `/app`、綠界**沙箱**回呼可從公開 HTTPS 收到、排程、每晚備份＋每週還原演練、告警。前台維持 VPS 上的「官網準備中」暫時頁（P12-12）。

## 0. 拓撲

```
網際網路（Aki 的瀏覽器、綠界 postgate-stage、UptimeRobot）
  │ HTTPS 443（Cloudflare 邊緣憑證）
  ▼
Cloudflare（zone smilelife.tw，Free）
  ├─ DNS：<API_HOST> CNAME → <tunnel-id>.cfargotunnel.com（橘雲）
  ├─ Access：整個 <API_HOST> 只放 Aki；/hooks/ecpay/* 與 /health 設 Bypass
  ├─ WAF custom rule：POST /hooks/ecpay/* 略過 managed rules／rate limit
  └─ Tunnel drn-tunnel → http://drn-backend:9000   （只有出站連線；Mac 與路由器不開任何入站 port）
Mac mini（Docker Desktop；Aki 登入後 LaunchAgent 啟動）
  ~/drn/bin/drn-docker ──▶ Docker Desktop 引擎
    compose 專案 drn
      drn_edge：drn-cloudflared（profile edge，只接 drn_edge）─┐
      drn_net ：drn-backend（server＋Admin；127.0.0.1:3961→9000；也接 drn_edge）
                drn-worker（排程、訂閱者；/health）
                drn-postgres（不發佈 port；資料卷 drn_pgdata）
                drn-redis   （不發佈 port；AOF；drn_redisdata）
      上傳檔：資料卷 drn_uploads（/app/.medusa/server/static）
    LaunchAgents：drn.compose-up（登入）、drn.monitor（每 5 分）、drn.backup（04:15）、drn.restore-check（週日 05:00）
機器外：Healthchecks.io（5 個檢查）、UptimeRobot（/health）、Cloudflare Tunnel 通知、R2 bucket drn-backups（age 加密）、USB 每月一份
```

主機事實（2026-10-13／14 查證）：Mac mini M4、16 GB、460 GB（約 189 GB 可用）、macOS 26.4、Docker Desktop 29.6.1（引擎 10 CPU／8 GiB）。Docker Desktop 的 `AutoStart` 目前是 `False`。

## 1. 要 Aki 核准的決定（一次回覆「D1–D25 照建議」或逐條改）

| # | 決定 | 建議 |
|---|---|---|
| D1 | Mac mini 守則 | CLAUDE.md §1b 草案照用 |
| D2 | 容器執行環境 | **Docker Desktop**（Aki 2026-10-13 已安裝）。原計畫的 Colima 不用；代價：正式資料卷與 Aki 自己的容器共用同一個 VM，Docker Desktop 的 Reset／更新會波及正式環境 |
| D2b | drn-dev 與正式環境的位置 | 都在 Docker Desktop；`drn-docker` 包裝用自己的 client 設定，不碰 `~/.docker/config.json` |
| D3 | 記憶體預算 | 容器上限合計 4 GiB（backend 1536m、worker 1024m、postgres 1024m、redis 256m、cloudflared 256m），都在 Docker Desktop 的 8 GiB 內；postgres／redis `oom_score_adj -500` |
| D4 | FileVault | 保留；冷開機由 Aki 在主控台解鎖後自動登入；計畫性重開用 `sudo fdesetup authrestart` |
| D5 | 開機啟動層級 | LaunchAgent（Aki 登入後）；Aki 承諾正式站運作期間不登出；Docker Desktop 設「登入時自動啟動」 |
| D6 | UPS | 購買 USB 在線互動式 UPS；不擋沙箱上線，擋收真實訂單 |
| D7 | macOS 更新 | 關掉自動安裝 macOS 更新；每月維護時段先 `drn-maint quiet` 再手動更新與 `authrestart` |
| D8 | 資料庫 TLS | 已實作（P12-14）：只有精確主機名 `drn-postgres` 免 TLS，`?host=`／`?hostaddr=` 一律拒絕；DATABASE_URL 帶 `?sslmode=disable`（P12-17 的發現） |
| D9 | 上傳檔 | 已實作（P12-15）：file-local＋資料卷 `drn_uploads`，公開網址 `<MEDUSA_BACKEND_URL>/static` |
| D10 | Redis 持久化 | 已實作（P12-02）：AOF everysec，不另外備份 |
| D11 | 遙測與日誌 | `MEDUSA_DISABLE_TELEMETRY=true`；容器日誌 json-file 10m×3；ALERT 行另存 `~/drn/logs/alerts-YYYYMM.log` |
| D12 | 對外 API 主機名稱 | 建議 `drn-api.smilelife.tw`（Universal SSL 只涵蓋第一層子網域，研究已查證）；刪除舊的 A 記錄 `api.dr.nature.smilelife.tw` |
| D13 | Bot Fight Mode | Aki 先唯讀查看；開著時不整個關，改對綠界 postgate 的 IP 建 IP Access rule Allow |
| D14 | cloudflared 位置 | 容器 `drn-cloudflared`（profile edge），token 放 `~/drn/tunnel.env`（600） |
| D15 | Access 範圍 | 整個主機名稱只放 Aki；`/hooks/ecpay/*` 與 `/health` Bypass；monitor 每小時比對 Access 漂移 |
| D16 | 模擬付款旗標 | 只透過 `drn-drill.sh simpay on\|off` 以 override 檔開關；monitor 監看 |
| D17 | 沙箱資料 | U-02 切正式時重建 `drn_pgdata`、重跑遷移、重邀管理員，保留一份沙箱 dump |
| D18 | 備份保留與加密 | 本機 daily 14／weekly 8／pre 3；異地 R2 用 age 公鑰加密；每月 USB；演練紀錄保存 5 年 |
| D19 | 告警管道 | Healthchecks.io 5 個檢查（Email＋Telegram）＋UptimeRobot＋Cloudflare Tunnel 通知 |
| D20 | 共住風險 | 沙箱期沿用 aki 帳號；收真實個資前（G-PII）搬到獨立使用者或專用主機 |
| D21 | 法務 | R2 境外加密備份是否要揭露、72 小時通報 SOP、是否達數位發展部辦法第 18 條門檻，由 Aki 或法律顧問確認 |
| D22 | production 缺 REDIS_URL 拒絕啟動 | 已實作（P12-24）；不採用就 revert 該提交 |
| D23 | 排程心跳 | 已實作（P12-20a）；演練映像的 worker 啟動 43 秒後就寫出 `[JOB-HEARTBEAT]` |
| D24 | 容器連往主機 | **Docker Desktop 沒有 VM 端防火牆可用**。drn-probe 實測：容器可經 `host.docker.internal` 連到主機上所有監聽埠，包括只綁 127.0.0.1 的服務（清單只在主機 `~/drn/logs/`）。三選一：A 沙箱期接受，monitor 每小時探測基準不變即可；B Aki 把主機上的服務改成需要密碼／只綁必要介面；C 專用主機。建議 A＋在 G-PII 前完成 B 或 C |
| D25 | monitor 唯一的自動動作 | 核心容器不在跑時補一次 `drn-compose-up.sh`（無維護旗標、30 分鐘冷卻）；已實作（P12-20） |

## 2. Aki 的步驟（依序；每步只需要幾分鐘）

1. **核准 D1–D25**（在對話回覆）。CODE 把核准原文寫進 P12-00 的提交訊息。
2. **電源**：`sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1 powernap 0`；系統設定 › 能源：顯示器關閉時防止自動睡眠、網路存取時喚醒、斷電後自動啟動；確認 `pmset -g custom`。
3. **軟體更新**：關掉「安裝 macOS 更新」，保留下載與安全回應；確認 `defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates` → 0。
4. **Docker Desktop**：Settings › General 勾「Start Docker Desktop when you sign in」；Resources 維持 8 GiB 以上。
5. **CODE 安裝主機套件**（`bash infra/host/install.sh`）並做部署前盤點後，Aki 執行：
   ```bash
   bash ~/drn/bin/drn-gen-env.sh drn-api.smilelife.tw && bash ~/drn/bin/drn-env-check.sh
   ```
   只回報 `missing=0 forbidden=0`，**不要貼任何值**。
6. **Cloudflare**（唯讀回報 Bot Fight Mode、Browser Integrity Check、custom rules 條數、rate limiting 額度、Under Attack；帳號開 2FA；刪除 `api.dr.nature` 的 A 記錄）。等 CODE 回報「遷移成功、本機煙霧測試通過」之後：
   - Zero Trust › Access：`drn-api-admin`（整個 `<API_HOST>`，Allow，只放 Aki，24h）；`drn-api-public`（`<API_HOST>/hooks/ecpay/*` 與 `/health`，Bypass，Everyone）。
   - Networking › Tunnels：建立 `drn-tunnel`（環境選 Docker），只複製 `eyJ` 開頭的 token，在 Mac 終端機執行：
     ```bash
     (umask 077; printf 'TUNNEL_TOKEN=%s\n' "$(pbpaste)" > ~/drn/tunnel.env); pbcopy </dev/null
     ```
   - Add route › Published application：`<API_HOST>` → `http://drn-backend:9000`；到 DNS 確認 CNAME 是橘雲。
   - WAF custom rule `drn-ecpay-callback-skip`（第一條）：`(http.host eq "<API_HOST>" and http.request.method eq "POST" and starts_with(http.request.uri.path, "/hooks/ecpay/"))` → Skip（managed rules、rate limiting、其餘 custom rules）。TODO(需查證)：運算式在 Free 方案的可用函式，建立時以後台提示為準。
   - 通知：Tunnel Health、Tunnel Creation／Deletion（Email）。
   - 在 `~/drn/host.env` 填 `DRN_API_HOST=<API_HOST>`。
7. **第一位管理員**（CODE 回報 edge 已啟用後）：
   ```bash
   ~/drn/bin/drn-docker exec -it drn-backend /app/node_modules/.bin/medusa user -e <管理信箱> --invite
   ```
   24 小時內透過 Access 開啟 `https://<API_HOST>/app/invite?token=…` 設密碼；登入後重新整理一次，回報 `connect.sid` 是否帶 `Secure; HttpOnly; SameSite=Lax`（正式模式只在 `X-Forwarded-Proto: https` 時才發 cookie，2026-10-13 本機驗證）。
8. **監控帳號**：Healthchecks.io 建 5 個檢查（`drn-heartbeat` 5m／grace 10m、`drn-ecpay-alert` 5m／15m、`drn-access` 1h／30m、`drn-backup` cron `15 4 * * *` Asia/Taipei／grace 2h、`drn-restore-check` cron `0 5 * * 0`／grace 3h），通知 Email＋Telegram；UptimeRobot 監看 `https://<API_HOST>/health` 關鍵字 `OK`；把 5 個 ping 網址填進 `~/drn/host.env`，然後 `bash ~/drn/bin/drn-env-check.sh --host` → `missing=0`。
9. **備份金鑰與異地**：`brew install age rclone`（CODE 會先查版本）；插 USB：`age-keygen -o /Volumes/<USB>/drn-backup-identity.txt && age-keygen -y /Volumes/<USB>/drn-backup-identity.txt >> ~/drn/age-recipients.txt`（第二把同樣做法，私鑰另存密碼管理器）；R2：建 bucket `drn-backups`，設 bucket lock（daily 14 天、weekly 56 天）與 lifecycle，建只限此 bucket 的權杖，`rclone config` 建 `drnr2`，`chmod 600 ~/.config/rclone/rclone.conf`，在 `host.env` 填 `DRN_R2_REMOTE=drnr2:drn-backups`。
10. **綠界演練**（P12-10）：開 CODE 產生的 `credit.html` 用公開測試卡付款、`atm.html` 取號、在廠商後台按「模擬付款」；到 Cloudflare Security Events 篩 `<API_HOST>` 的 `/hooks/ecpay/*` 回報筆數（預期 0）。
11. **整機重開演練**（P12-19，要在場）：Apple 選單 › 重新啟動，停在 FileVault 畫面至少 16 分鐘再解鎖，記下時間，回報收到的 down／up 通知。
12. **回滾演練**（P12-11）：當下點名核准 CODE 丟棄一筆刻意製造的寫入（`--accept-loss <code>`）。
13. 每完成一批提交就在終端機 `git push`；UPS 到貨後接 USB 並設 `pmset -u`。
14. 收真實訂單之前：G-PII（P12-25）、D17、D20、D21、U-02、U-16。

## 3. CODE 的步驟（Aki 核准 D1 之後）

每一步都是 DEV_PLAN P12 的一列，有驗收指令與回滾方式；這裡只列順序。

1. `bash infra/host/drn-inventory.sh snapshot ~/drn/logs/inventory-pre.txt`（P12-01；`~/drn` 先 `install -d -m 700`）。
2. `bash infra/host/install.sh`（P12-18）；確認 `test ! -e ~/drn/.env`、`launchctl list | awk -F'\t' '$3 ~ /^drn[.]/' | wc -l` → 0。
3. Aki 產生 `.env`（§2 第 5 步）。
4. `bash infra/host/drn-build.sh`（P12-03）→ 印出 `<sha12>`；`~/drn/state/image-ok-<sha12>` 存在。
5. 首次啟動（P12-06）：
   ```bash
   sha=<sha12>
   ~/drn/bin/drn-compose config -q && echo config-ok
   ~/drn/bin/drn-docker tag drn-backend:$sha drn-backend:current && bash ~/drn/bin/drn-releases.sh first $sha
   ~/drn/bin/drn-compose up -d --wait drn-postgres drn-redis
   ~/drn/bin/drn-compose run --rm --no-deps -T --name drn-migrate drn-backend /app/node_modules/.bin/medusa db:migrate --skip-scripts --execute-safe-links --execute-safe-search
   ~/drn/bin/drn-compose run --rm --no-deps -T --name drn-migrate drn-backend /app/node_modules/.bin/medusa db:migrate:scripts
   bash ~/drn/bin/drn-check-migrations.sh --image drn-backend:current     # unfinished=0 drn=7/7
   ~/drn/bin/drn-compose up -d --wait drn-backend drn-worker
   curl -fsS http://127.0.0.1:3961/health                                   # OK
   ```
   煙霧測試：4 個容器 healthy、`docker port drn-postgres`／`drn-redis` 無輸出、區網 IP 打 3961 → curl exit 7、worker 時區 UTC、`CONFIG GET appendonly` → yes、static 可寫、`/store/products` 回 3 件、`drn-releases.sh verify-current` → 0。（2026-10-14 已用改名的 `drn-rh-*` 演練全數通過。）
6. 隔離探測（P12-28）：`bash ~/drn/bin/drn-probe.sh --network drn_net --control`、`--dns`；把 `open` 數寫進 `~/drn/state/probe-baseline`，清單只留主機。
7. 等 Aki 完成 Cloudflare（§2 第 6 步）後啟用 edge（P12-04）：
   ```bash
   touch ~/drn/state/edge-enabled && ~/drn/bin/drn-compose up -d --wait drn-cloudflared
   ~/drn/bin/drn-docker logs drn-cloudflared 2>&1 | grep -c 'Registered tunnel connection'   # ≥1
   curl -fsS https://<API_HOST>/health                                                        # OK
   for p in /app /admin/users/me /store/products /static/x; do curl -s -o /dev/null -w "$p %{http_code} %{redirect_url}\n" https://<API_HOST>$p; done   # 302 到 cloudflareaccess.com 或 403，絕不能 200
   for p in payment payment-info logistics; do curl -s -w ' %{http_code}\n' -X POST -d a=1 https://<API_HOST>/hooks/ecpay/$p; done   # 0|CheckMacValue Error 400
   bash ~/drn/bin/drn-monitor.sh --record-access-baseline
   ```
8. 啟用 LaunchAgents：`bash ~/drn/bin/agents.sh enable drn.backup drn.restore-check drn.monitor drn.compose-up`，各 `kick` 一次並看 `status`；備份成功後 `touch ~/drn/state/backup-enabled`，R2 驗證後 `touch ~/drn/state/offsite-required`。
9. 告警演練（P12-20）、整機重開（P12-19）、綠界沙箱演練（P12-10）、升級與回滾演練（P12-11）、部署後盤點 `drn-inventory.sh compare`（P12-09）。

## 4. 升級與回滾 SOP

- 升級：提交 → `bash infra/host/drn-build.sh` → `bash ~/drn/bin/drn-deploy.sh <sha12>`。順序固定：前置檢查 → `drn-maint stop`（先停 worker 再停 backend）→ pre dump（寫進 `releases.log`）→ retag current → 兩步遷移 → `drn-check-migrations` → `up --wait` → 驗證映像 Id 與 `/health` → 記錄指紋 → `drn-maint end`。任何一步失敗都保留維護旗標並印出回滾指令。
- 回滾 R1（只換映像）：`drn-rollback.sh <舊sha>`，只允許在 ledger 停在 `deploy`（新版遷移沒跑）時。
- 回滾 R2（還原資料庫）：`drn-rollback.sh <舊sha> --restore <pre dump>`。部署後若有任何寫入（業務表指紋變了），以 exit 4 拒絕並印出各表筆數；只有 Aki 點名核准才加 `--accept-loss <code>`。還原前一定先做 pre-rollback dump（永不自動刪）與非破壞性演練。還原後要用 pre-rollback dump 核對部署後建立的 `merchant_trade_no`（綠界後台人工補登）。
- 設定回滾：`git revert` → `bash infra/host/install.sh` → `drn-compose up -d --wait`。LaunchAgent：`agents.sh disable <drn.*>`。對外：`rm ~/drn/state/edge-enabled && drn-compose stop drn-cloudflared`，必要時到 Cloudflare 刪 route／Rotate token。
- 兩振出局：同一任務失敗兩次就停手回報。

## 5. 停電、重開、整機重建

- 停電／重開：Aki 在主控台解鎖 FileVault → 自動登入 → Docker Desktop 自動啟動 → `drn.compose-up` 等 Docker API（最多 300 秒）→ `drn-compose up -d --wait` → `/health`。期間 Healthchecks 的 heartbeat 與 UptimeRobot 會各報一次 down 再 up。
- 容器自己掛掉：`restart: unless-stopped` 先恢復；還是不在跑時 monitor 補一次 compose-up（D25）。
- 整機重建：安裝 Docker Desktop → `install.sh` → Aki 重新產生 `.env`（DB 密碼要配合還原的 dump，或 `ALTER ROLE`）→ 只起 `drn-postgres` → `age -d` 解密最新 dump → `pg_restore` → 還原上傳檔（`gunzip -c … | drn-docker run --rm -i -v drn_uploads:/dst --entrypoint tar <postgres digest> -C /dst -xf -`）→ 依 `releases.log` 的 sha 建映像 → `drn-releases.sh first` → 遷移（應為 no-op）→ up → 重寫 `tunnel.env`。

## 6. 禁止事項（摘自 CLAUDE.md §1b）

不 `sudo`；不 `prune`；不 `compose down -v`；不 `docker volume rm`（除非 Aki 逐次核准）；不讀 `.env`／`tunnel.env`／`host.env`；`docker inspect` 一律帶 `-f`；不在正式容器跑 `src/scripts`（`print-publishable-keys`、`ecpay-public-drill` 例外）；不碰 Aki 的容器、LaunchAgents、系統設定。

## 7. 這份 runbook 不能證明的事

- 綠界**正式**環境的行為（真實特店、真實扣款、TradeNoAio 白名單——家用 IP 不固定，U-16）。
- 物流狀態通知真的由綠界送進來（stage 不推送）；需要前台的流程（導回頁、選店回傳、OAuth、驗證信）。
- FileVault 開著時冷開機能否無人恢復；只能看 P12-19 的實測。
- cloudflared 是否轉送 `X-Forwarded-Proto`：由 P12-22 的登入實測決定；失敗就改用 Transform Rule（TODO(需查證) Free 方案額度）。
- 容器完全碰不到主機服務：Docker Desktop 做不到（D24），只能靠探測基準與 G-PII 前的搬遷。
- 升級／回滾在本機只用假 Docker 測過順序；真實演練是 P12-11。
