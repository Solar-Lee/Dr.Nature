# CODE 交接：換到 Mac mini 接續（2026-10-13）

給在 Mac mini 上新開的 Claude Code 工作階段。依序讀：`CLAUDE.md`（絕對禁令）→ 本檔 → [DEV_PLAN.md](../DEV_PLAN.md)。本檔取代舊工作階段的本機記憶（那份記憶留在舊電腦，不會跟著 repo 過來）。

## 1. Aki 的最新決定（2026-10-13 18:40 前後）

| 決定 | 內容 |
|---|---|
| U-04 暫不升級 | 不用 Supabase Pro，也沒有 Vercel 團隊。Supabase 組織「Alex-Lee's Org」是 Free 方案，已有 2 個其他系統的專案 |
| U-05 已完成 | `api.dr.nature.smilelife.tw` A → 151.145.69.134（DNS only），2026-10-13 已查證可解析。**若改走 Mac mini＋Cloudflare Tunnel，這筆記錄要改**（見 §4） |
| **正式主機改為 Mac mini M4**（24 GB 以上 RAM／512 GB 以上 SSD） | 取代 DEV_PLAN A3 的「VPS＋Supabase」。資料庫先自架在 Mac mini（`drn-postgres`），之後可搬到 Supabase |
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

## 4. 下一步：在 Mac mini 上

### 4.1 準備環境（每個版本號都先查證，CLAUDE.md §3）
1. 安裝：Xcode Command Line Tools、git、git-lfs、Node 22（與 CI 相同主版本）、pnpm 9.15.9（`corepack`）、容器執行環境（Docker Desktop 或 OrbStack，選定前查證兩者在 Apple Silicon 開機自動啟動、資源限制、compose 支援）。
2. `git clone https://github.com/Solar-Lee/Dr.Nature.git` → `pnpm install --frozen-lockfile`。
3. 啟動開發用 Postgres／Redis：`docker compose -f infra/docker-compose.dev.yml up -d`（Postgres 在 localhost:55432）。
4. **先跑 `bash scripts/test-all.sh`，離場碼 0 才能往下做**。這也證明 Mac mini 的環境與舊電腦一致。

### 4.2 重新規劃正式部署（Mac mini 版）
用 workflow 重跑「研究 → 三份競爭方案 → 評審 → 批評與修訂迴圈」，事實換成 Mac mini。舊工作階段的規劃流程在研究階段就被停下，沒有可沿用的結論。要決定與查證的重點：

- **對外連線**：建議 Cloudflare Tunnel（`smilelife.tw` 已在 Cloudflare 免費方案）。不用固定 IP，也不用開路由器 port。Tunnel 的 token 是憑證：由 Aki 在 Cloudflare 後台建立並自己安裝到 Mac mini。`api.dr.nature.smilelife.tw` 要從 A 記錄改成指向 Tunnel、且開代理的記錄。做法查證官方文件後再定（TODO(需查證)）。
- **常開與自動恢復**：關閉睡眠、停電後自動開機、登入後自動啟動容器執行環境與容器（`restart: unless-stopped`）、作業系統更新的時間。全部查證 macOS 目前版本的設定方式。
- **容器**：compose 專案 `drn`；`drn-backend`（server＋Admin）、`drn-worker`、`drn-postgres`、`drn-redis`；網路 `drn_net`；資料卷 `drn_pgdata`、`drn_redisdata`；資料庫與 Redis 不對外發佈 port。映像直接在 Mac mini 建置，不需要映像倉庫。
- **Medusa 正式模式**要查證（2.21.2 原始碼）：server／worker 分工、Admin 建置時是否需要後端網址、正式需要的環境變數、健康檢查路徑、兩步驟遷移（`pnpm run migrate`）、哪些種子腳本可以用在正式環境（`dev-add-test-stock` 只能用在開發與測試）、第一個管理員用邀請方式建立（代理不經手密碼）。
- **綠界沙箱回呼**：列出所有回呼路徑（`src/api/hooks/ecpay/*`、物流、發票）與組網址的環境變數，上線後跑一次完整的沙箱付款。
- **備份**：每晚 `pg_dump`、保留天數，加一份機器以外的副本（外接碟或 Aki 的私人雲端；**顧客個資絕不能放公開位置**，GitHub 公開 repo 不行），並實際做一次還原演練。
- **暫時頁**：決定 `dr.nature.smilelife.tw` 留在 VPS，或也改走 Tunnel。若改走 Tunnel，VPS 上的 `drn.conf`、`/var/www/drn`、憑證要照 CLAUDE.md §1 的方式移除（刪 symlink → `nginx -t` → `reload`），而且需要 `docs/private/` 與 SSH 金鑰。

## 5. 已知陷阱（舊工作階段踩過的）

- **Medusa 2.21.2**：`db:migrate` 在 script 失敗時仍回 0，所以遷移用 `pnpm run migrate`（兩步）。RBAC 需要旗標加上明確的模組設定。有 27 個管理端寫入路由沒有自己的權限政策，已在 `src/api/middlewares.ts` 補上，每次升級都要重新稽核。completeCart 的 validate hook 只能註冊一個處理函式。鎖不可重入（記憶體版直接拋錯，Redis 版回 CONFLICT）。`createPaymentSessionsWorkflow` 會硬刪集合內所有 session。訂單品項沒有固定順序。
- **本機開發伺服器**：`pkill -f "medusa develop"` 殺不乾淨；用 `lsof -t -iTCP:9000` 找出 PID。殘留的 `medusa develop` worker 會連著 Redis 吃掉事件，新的訂閱者因此不會執行。跑 E2E 前確認沒有殘留程序。
- **測試**：
  - `pnpm run test:integration:http -- <檔> -t <名稱>` 不會過濾。直接用 `../../infra/test-env.sh env TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --forceExit <檔> -t "<名稱>"`。
  - `-t` 是正規表示式：名稱裡的括號要避開或跳脫。
  - 整合測試的替身固定綁 56390～56393 port，不能同時跑兩組整合測試。
  - `test-all.sh` 執行期間不要改原始碼：jest 是延遲載入，會讀到改到一半的檔案。
- **反向測試協定**（CLAUDE.md §4）：用 `scripts/mutate.py` 在另一個 git worktree 裡做（見檔頭用法）。「沒有任何測試執行」一律判為無效，不算轉紅。弄壞後仍然綠，通常是少了斷言，要補測試，不是放過。競態可以在整合規格裡用 `jest.mock` 包住真正的模組、在指定時間點插入動作，讓結果固定（範例：`integration-tests/http/ecpay-cancel-race.spec.ts`）。
- **磁碟**：舊電腦曾因本機 `docker build` 把磁碟塞滿、Docker 當掉。建映像前先確認剩餘空間；**任何全域清理指令（prune）都要先問 Aki**。
- **綠界**：先成立訂單再付款。ReturnURL 通知經過 CheckMacValue 驗證、且綁定交易編號、session 與金額，才算付款證明。退款目前記為 manual_pending，SOP 在 [ops/ecpay-manual-refund.md](../ops/ecpay-manual-refund.md)。只用官方公開的沙箱值。
- **寄信**：U-09 選定前，正式站只能用 Google 註冊新會員，而 Google OAuth 也還沒設定（U-17）。

## 6. 等 Aki 的事（詳見 DEV_PLAN §6）

U-01 輪替外露的 LINE 憑證、U-02 綠界正式特店、U-09 寄信服務、U-12 研發長書面同意、U-15 貨本、U-16 綠界 IP 白名單（主機換成 Mac mini 後，要填的是 Mac mini 對外的 IP，或改用其他方式，需查證）、U-17 LINE／Google 回呼網址、U-18 付款規則、U-19 要問綠界的事、G2 命名、G5 品牌故事、P0-10 用一個故意弄壞的 PR 驗證 CI 會轉紅。

## 7. 新工作階段建議的第一句話

> 讀 CLAUDE.md、docs/handoff/CODE_HANDOFF.md、docs/DEV_PLAN.md，在這台 Mac mini 上準備環境並跑通 test-all，再用 workflow 規劃並執行 MVP 正式站部署（Mac mini 為正式主機）。
