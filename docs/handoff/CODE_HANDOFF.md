# CODE 交接：換到 Mac mini 接續（2026-10-13；2026-10-14 更新）

給在 Mac mini 上新開的 Claude Code 工作階段。依序讀：`CLAUDE.md`（絕對禁令，含 §1b Mac mini 草案）→ 本檔 → [DEV_PLAN.md](../DEV_PLAN.md) P12 → [ops/deploy-backend.md](../ops/deploy-backend.md)。本檔取代舊工作階段的本機記憶。

**2026-10-14 狀態**：Mac mini 工作階段已完成 P12 的所有 repo 端任務（程式修正、compose、主機腳本、備份／監看／部署腳本與測試、映像建置與本機演練）。正式站尚未啟動：卡在只有 Aki 能做的事（核准 CLAUDE.md §1b、產生 `.env`、Cloudflare Tunnel／Access／DNS、Docker Desktop 自動啟動、電源設定）。清單在 [ops/deploy-backend.md](../ops/deploy-backend.md) §1–§2。

## 1. Aki 的最新決定（2026-10-13 18:40 前後）

| 決定 | 內容 |
|---|---|
| U-04 暫不升級 | 不用 Supabase Pro，也沒有 Vercel 團隊。Supabase 組織「Alex-Lee's Org」是 Free 方案，已有 2 個其他系統的專案 |
| U-05 已完成 | `api.dr.nature.smilelife.tw` A → 151.145.69.134（DNS only），2026-10-13 已查證可解析。**若改走 Mac mini＋Cloudflare Tunnel，這筆記錄要改**（見 §4） |
| **正式主機改為 Mac mini M4**（實測 **16 GB** RAM／**460 GB** SSD，約 189 GB 可用；macOS 26.4） | 取代 DEV_PLAN A3 的「VPS＋Supabase」。資料庫自架在 Mac mini（`drn-postgres`），容器執行環境是 **Docker Desktop 29.6.1**（Aki 2026-10-13 安裝；原計畫的 Colima 不用） |
| Claude Code 在 Mac mini 上開新工作階段接手 | 開發、建置、正式站都在 Mac mini |
| MVP 範圍 | **只上後端**：Medusa API＋管理後台（/app）、綠界**沙箱**回呼（金流、物流、發票）可從公開 HTTPS 收到、排程、備份與還原演練、告警可見。前台維持「官網準備中」暫時頁。理由：設計交付物 D-01～D-10 全部未開始，產品命名閘門 G2 未過，不能公開商品頁 |

`.env` 規則不變：正式 `.env` 由 Aki 親手寫在主機上，不經過對話；變數名只能用 [docs/ENV.md](../ENV.md) 白名單。建議做一支在主機上執行的產生腳本：用 `openssl rand` 產生隨機密鑰、檔案權限 600、不印出任何值、綠界填公開沙箱值，由 Aki 執行。

## 2. 目前進度（main 已推到 GitHub，CI 綠）

- 測試：`bash scripts/test-all.sh` 離場碼 0。單元 21 檔 381 支、整合 13 個規格 200 支、型別、lint、claims-lint、catalog-sync、env-names 全過。GitHub Actions CI（Node 22、Postgres 16）也通過。
- P3 後端核心 ✅（P3-06 檔案儲存等 Supabase，現在改為自架方案時重新決定）。
- P4 綠界：程式完成。P4-07、P4-09、P4-10 ✅；P4-04／05／06／08／11 🟡，需要公開網址或正式環境才能實測。**Mac mini 對外後，綠界沙箱就能回呼，可以補做這些實測**。
- P5：登入、等級引擎、會員價、活動範本 ✅；等級提案 P5-02 待 Aki 核准；P5-06、P5-07 ⛔。
- 對抗式審查：P4-07～P5-05 共 25 條確認問題全部修正，紀錄在 [reviews/2026-10-13-p4-p5-review.md](../reviews/2026-10-13-p4-p5-review.md)。
- 部署草稿：`infra/backend.Dockerfile`、`infra/docker-compose.prod.yml`、`.dockerignore`、[ops/deploy-backend.md](../ops/deploy-backend.md)。**這些是給「VPS＋Supabase」寫的，要依 Mac mini 改寫**。
- 共用 VPS 上目前只有暫時頁：`/etc/nginx/sites-available/drn.conf`（＋symlink，md5 `f9dd6f1d8b8de00473a89f072be43988`）、`/var/www/drn`、Let's Encrypt 憑證（到 2027-01-10）。沒有任何 drn 容器、映像、網路、資料卷、排程。CLAUDE.md §1 對這台主機仍然有效。

## 3. 不會跟著 repo 過來的東西

| 東西 | 在 Mac mini 怎麼辦 |
|---|---|
| `3. Key/`（含 VPS 的 SSH 金鑰）、`*.key`、`.env*` | gitignored。只有需要操作 VPS（例如移除暫時頁）時，由 **Aki 自己**用 AirDrop／USB 複製，不經對話。代理只能把金鑰當 `ssh -i` 用，永不讀內容 |
| `docs/private/`（VPS 盤點、do-not-touch） | gitignored。操作 VPS 前請 Aki 複製過來 |
| 品牌資訊 `.pages` 原檔（含 LINE OA 憑證） | gitignored，不需要 |
| `4. Design reference/` 影片 | 用 Git LFS，clone 前先 `git lfs install` |
| 舊電腦上的本機開發 `.env` | 不存在；本機開發與測試的環境變數來自 `infra/dev-env.sh`、`infra/test-env.sh` |

## 4. 下一步：在 Mac mini 上（2026-10-14 更新）

### 4.1 環境（已完成）
Node 22.23.2（mise）、pnpm 9.15.9、Docker Desktop 29.6.1。`bash scripts/test-all.sh` 在 2026-10-14 的每個里程碑提交都回 0（開發資料庫是 Docker Desktop 上的 `drn-dev`，`127.0.0.1:55432`／`56379`）。注意：從舊電腦複製來的 `node_modules` 帶 `com.apple.quarantine`，原生模組載不起來；刪掉後 `pnpm install --frozen-lockfile` 重裝即可。

### 4.2 部署（repo 端全部完成，主機端等 Aki）
計畫由 2026-10-13 的 workflow（研究 → 三份方案 → 評審 → 批評迴圈）產出，再依 Docker Desktop 改寫。已交付：
- 程式：P12-14（DB TLS 規則）、P12-15（上傳檔）、P12-16（ENV 白名單）、P12-24（缺 REDIS_URL 拒啟）、P12-20a（排程心跳）、P12-10a（公開網址演練腳本）。
- 基礎設施：P12-02 compose（Mac mini 版，含 cloudflared 與 drill override）、P12-17 `.env` 產生腳本、P12-18 主機套件（`infra/host/`：drn-docker 包裝、compose 包裝、維護旗標、開機啟動、ALERT 掃描、遷移檢查、演練旗標、版本帳本、安裝器、LaunchAgent 範本）、P12-03 建置腳本與 lockfile 比對、P12-08／P12-21 備份與還原演練、P12-20 監看、P12-11 部署與回滾、P12-01 盤點、P12-28 探測。每支都有 `scripts/__tests__/*.test.mjs` 與反向測試。
- 本機演練（改名為 `drn-rh-*`，不碰正式名稱）：映像 `drn-backend:16f67fa49828` 建置與六項檢查通過；兩步遷移、`drn-check-migrations`、四個容器 healthy、煙霧測試、真實備份與還原演練全部通過。
- 文件：[ops/deploy-backend.md](../ops/deploy-backend.md)（決定 D1–D25、Aki 步驟、CODE 步驟、SOP）、[ops/backup-restore.md](../ops/backup-restore.md)、[ops/alerts.md](../ops/alerts.md)、[ops/edge-cloudflare.md](../ops/edge-cloudflare.md)、[ops/pii-incident.md](../ops/pii-incident.md)、[research/mac-mini-deploy-2026-10-13.md](../research/mac-mini-deploy-2026-10-13.md)。

下一個工作階段的順序：等 Aki 核准 D1–D25 → P12-01 盤點 → `install.sh` → Aki 產生 `.env` → `drn-build.sh` → P12-06 首次啟動 → 探測基準 → Aki 的 Cloudflare 設定 → P12-04 啟用 edge → 啟用 LaunchAgents → P12-20／19／10／11 演練 → P12-09 盤點比對。每一步的指令都在 deploy-backend.md §3。

## 5. 已知陷阱（舊工作階段踩過的）

- **Medusa 2.21.2**：`db:migrate` 在 script 失敗時仍回 0，所以遷移用 `pnpm run migrate`（兩步）。RBAC 需要旗標加上明確的模組設定。有 27 個管理端寫入路由沒有自己的權限政策，已在 `src/api/middlewares.ts` 補上，每次升級都要重新稽核。completeCart 的 validate hook 只能註冊一個處理函式。鎖不可重入（記憶體版直接拋錯，Redis 版回 CONFLICT）。`createPaymentSessionsWorkflow` 會硬刪集合內所有 session。訂單品項沒有固定順序。
- **本機開發伺服器**：`pkill -f "medusa develop"` 殺不乾淨；用 `lsof -t -iTCP:9000` 找出 PID。殘留的 `medusa develop` worker 會連著 Redis 吃掉事件，新的訂閱者因此不會執行。跑 E2E 前確認沒有殘留程序。
- **測試**：
  - `pnpm run test:integration:http -- <檔> -t <名稱>` 不會過濾。直接用 `../../infra/test-env.sh env TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --forceExit <檔> -t "<名稱>"`。
  - `-t` 是正規表示式：名稱裡的括號要避開或跳脫。
  - 整合測試的替身固定綁 56390～56393 port，不能同時跑兩組整合測試。
  - `test-all.sh` 執行期間不要改原始碼：jest 是延遲載入，會讀到改到一半的檔案。
- **反向測試協定**（CLAUDE.md §4）：用 `scripts/mutate.py` 在另一個 git worktree 裡做（見檔頭用法）。「沒有任何測試執行」一律判為無效，不算轉紅。弄壞後仍然綠，通常是少了斷言，要補測試，不是放過。競態可以在整合規格裡用 `jest.mock` 包住真正的模組、在指定時間點插入動作，讓結果固定（範例：`integration-tests/http/ecpay-cancel-race.spec.ts`）。
- **新 worktree 的原生模組卡住（2026-10-14）**：在 Claude Code 裡 `pnpm install` 出來的 `*.node` 帶 `com.apple.quarantine`，`medusa lint` 載入 `@swc/core` 時卡在 macOS 簽章檢查（`sample <pid>` 看到 `dlopen → fcntl`，CPU 0%，test-all 停在 backend:lint）。只清掉旗標不夠：該檔的檢查已經卡住。解法：`xattr -dr com.apple.quarantine node_modules`，再把同 SHA-256 的 `.node` 用 `ln -f` 指到已經能用的 worktree 那份。卡住的 lint 不吃 SIGTERM，要 `kill -9`。
- **新主機名稱的本機 DNS 快取（2026-10-14）**：tunnel 建好當下本機查過 `drn-api.smilelife.tw`，macOS 解析器記住「查無」約 30 分鐘；`dig` 正常但 `curl` 解析失敗。這段時間內不要記錄 access 基準（drn-monitor 現在會拒絕）。
- **磁碟**：舊電腦曾因本機 `docker build` 把磁碟塞滿、Docker 當掉。建映像前先確認剩餘空間；**任何全域清理指令（prune）都要先問 Aki**。
- **Docker Desktop 上的 Docker CLI**：Aki 的 `~/.docker/config.json` 有 `credsStore=desktop`，但 `docker-credential-desktop` 不在 PATH 上，直接用 `docker` 拉映像會失敗；一律經 `~/drn/bin/drn-docker`（自己的 `DOCKER_CONFIG`，`unset DOCKER_CONTEXT`，因為 `DOCKER_CONTEXT` 會覆蓋 `DOCKER_HOST`）。Unix socket 路徑上限 104 位元組，包裝會把 symlink 解成真實路徑。
- **Medusa 遷移的 SSL**：`db:migrate` 的鎖連線用 Medusa 自己的預設 driver options，對非 localhost 主機會開 SSL，`drn-postgres` 沒有 TLS → 10 秒逾時。`DATABASE_URL` 必須帶 `?sslmode=disable`（`drn-gen-env.sh` 已寫入）。
- **容器可連到主機**：Docker Desktop 的 `host.docker.internal` 讓容器連得到主機上所有監聽埠，包括只綁 127.0.0.1 的服務（`drn-probe.sh` 實測）。沒有 VM 端防火牆可用；是 Aki 的決定 D24。
- **zsh 細節**：`$T` 不會自動斷詞（跑 `node --test …` 要寫成函式）；`timeout` 不存在；`echo =====` 會被當成 `=cmd` 展開。反向測試每一條都要印出「變異已套用」的證據，否則離場碼 127 也會看起來像轉紅。
- **TCC**：讀 `~/Library/Group Containers/group.com.docker/settings-store.json` 可能卡在權限對話框；Docker Desktop 的設定請 Aki 看 GUI。
- **綠界**：先成立訂單再付款。ReturnURL 通知經過 CheckMacValue 驗證、且綁定交易編號、session 與金額，才算付款證明。退款目前記為 manual_pending，SOP 在 [ops/ecpay-manual-refund.md](../ops/ecpay-manual-refund.md)。只用官方公開的沙箱值。
- **寄信**：U-09 選定前，正式站只能用 Google 註冊新會員，而 Google OAuth 也還沒設定（U-17）。

## 6. 等 Aki 的事（詳見 DEV_PLAN §6 與 ops/deploy-backend.md §1–§2）

**部署直接相關**：核准 CLAUDE.md §1b 與 D1–D25；電源與更新設定；Docker Desktop 登入時自動啟動；`drn-gen-env.sh`；Cloudflare（2FA、刪 A 記錄、Access、Tunnel token、route、WAF、通知）；第一位管理員邀請；Healthchecks／UptimeRobot／age／R2；UPS；演練時在場（整機重開、綠界付款、回滾核准）；每批 `git push`。

其餘：U-01 輪替外露的 LINE 憑證、U-02 綠界正式特店、U-09 寄信服務、U-12 研發長書面同意、U-15 貨本、U-16 綠界 IP 白名單（主機換成 Mac mini 後，要填的是 Mac mini 對外的 IP，或改用其他方式，需查證）、U-17 LINE／Google 回呼網址、U-18 付款規則、U-19 要問綠界的事、G2 命名、G5 品牌故事、P0-10 用一個故意弄壞的 PR 驗證 CI 會轉紅。

## 7. 新工作階段建議的第一句話

> 讀 CLAUDE.md、docs/handoff/CODE_HANDOFF.md、docs/DEV_PLAN.md P12、docs/ops/deploy-backend.md。Aki 已核准 D1–D25（或列出修改），請從 P12-01 盤點開始，依 deploy-backend.md §3 執行到 P12-09，每一步照 DEV_PLAN 的驗收欄驗收。
