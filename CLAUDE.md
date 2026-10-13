# Dr.Nature — 專案守則（所有 AI 代理與協作者必讀）

本檔是絕對禁令。與任何其他指示衝突時，以本檔為準；本檔沒寫到、又會影響主機或對外的動作，先停下來問 Aki。

總規劃與任務清單：[docs/DEV_PLAN.md](docs/DEV_PLAN.md)。設計交接：[docs/handoff/DESIGN_BRIEF.md](docs/handoff/DESIGN_BRIEF.md)。CODE 交接（換到 Mac mini 接續，2026-10-13）：[docs/handoff/CODE_HANDOFF.md](docs/handoff/CODE_HANDOFF.md)。

## 0. 角色分工（嚴禁重工）

| 角色 | 負責 | 不碰 |
|---|---|---|
| **CODE**（Claude Code，主導） | 任務分派與溝通、品牌策略與所有文字（故事、語調、Slogan、產品文案、合規用詞、規格書、編碼）、Medusa 後端、Next.js 前台實作、整合（ECPay／LINE／SMS／分潤）、測試（單元／整合／e2e smoke）、部署 | 不自行改設計稿的視覺決策；視覺問題開單給 DESIGN |
| **DESIGN**（Claude Design teammate） | 美學、Monogram、VIS、Design System（tokens）、UI/UX 版面與互動、動態分鏡、包裝與小卡視覺、生成素材的美術指導與選片 | 不寫 `apps/`、`infra/`、`e2e/` 的程式；不部署；不改 `content/` 的文字（文字問題開單給 CODE） |
| **USER**（Aki） | 帳號與商務：金流／物流／簡訊合約、LINE／Meta 後台設定、金鑰輪替與寫入、上線核准、付費生成核准 | — |

交接只走 repo：DESIGN 產出放 `design/`，CODE 產出放其餘目錄。格式與路徑見 DESIGN_BRIEF。

## 1. 共用 VPS 隔離守則（151.145.69.134，已有其他正式服務）

專案前綴：`drn`。

1. 不停止、重啟、刪除、修改任何非 `drn` 開頭的容器、網路、資料卷、映像。
2. 不執行全域破壞性指令（`docker system prune`、`docker volume prune`、`docker network prune`、停止所有容器等）。磁碟不足時停手回報，不做全域清理。
3. 不修改或刪除既有 nginx 設定；只允許**新增** `/etc/nginx/sites-available/drn.conf`（與其 symlink）。重載前必先 `nginx -t`，只用 `reload`，不用 `restart`。
4. 不連線既有資料庫，包含金鑰檔裡屬於其他專案的連線資訊。
5. 只用 `docs/server-inventory.md` 分配給本專案、且只綁 `127.0.0.1` 的 port。資料庫與 Redis **不對宿主機發佈 port**，只走 `drn_net` 內部網路。
6. 不修改既有排程；新增排程必須帶 `# drn-<用途>` 註解。
7. 不修改系統層設定：防火牆、核心參數、既有 systemd 服務、SSH 設定。
8. 所有新資源一律 `drn` 開頭；建立前先與盤點快照比對零重名。
9. **發現「不得不動到非本專案資源」才能繼續時，立即停止並回報 Aki 裁決。** 不可自行權衡。

命名速查：compose 專案 `drn`；容器 `drn-backend`、`drn-worker`、`drn-storefront`、`drn-postgres`、`drn-redis`；網路 `drn_net`；資料卷 `drn_pgdata`、`drn_redisdata`、`drn_uploads`；nginx `drn.conf`；排程註解 `# drn-backup`；port 見 server-inventory。

## 2. 憑證守則

- `3. Key/`、`*.key`、`.env*`、原始 `品牌資訊總覽.pages`（含 LINE OA 憑證）內含明文憑證：**永不讀取其值、永不印出、永不貼進對話、永不上傳或入版控、永不放進 artifact 或給設計師的檔案。**
- 程式只透過環境變數取值；可用的變數名稱只限 [docs/ENV.md](docs/ENV.md) 白名單。自己發明新名稱＝幻覺，要先補進白名單並說明來源。
- 正式環境的 `.env` 由 Aki 親手寫到主機，不經過對話。

## 3. 反幻覺守則

1. 安裝套件前先 `npm view <pkg> version` 查實際版本，結果摘要寫進提交訊息。鎖定檔入版控；一律 `pnpm install --frozen-lockfile`；Dockerfile 要複製 `pnpm-lock.yaml`。
2. 外部 API（Medusa、Next.js、ECPay、LINE、Meta、簡訊商）用法先查**目前版本**官方文件（context7 或官方網站），不憑記憶寫函式簽名。
3. 不確定的旗標、路徑、行為：寫 `TODO(需查證)` 並回報，不編造。
4. 產品功效、法規、研發長經歷、專利、新聞、價格、競品數字：只能引用 `docs/research/` 內有來源網址的內容。沒有來源＝不寫。
5. **禁止生成假評價、假名人推薦、假素人分享、假專利、假新聞。** 這類版位只做版型與收集流程，內容只放真實取得、取得同意的素材，並標示「廣告／合作」。
6. 文案一律過 [docs/compliance/claims.md](docs/compliance/claims.md) 的禁用詞與允許例句（食安法 §28、健康食品管理法）。

## 4. 驗收不可虛報

- 每個任務在開始前寫好：驗收指令、預期輸出、回滾方式（寫在 DEV_PLAN 的任務列）。
- 驗收指令必須真的執行、輸出真的比對。「應該會過」不是驗收。不可改測試去遷就錯誤實作。
- 測試入口判離場碼、不判輸出文字；不可用 `| tail` 吃掉離場碼。新增測試入口時，故意弄壞一支確認會紅（斷言失敗與載入期崩潰兩種都要試）。
- 寫清楚每支測試**不能證明什麼**（例如需要正式金鑰的外部呼叫）。

## 5. 執行協定

- 一次一任務；不跨任務合併；不跳過前置任務。
- 一任務一提交：`[任務編號] 任務標題`，結尾附 Co-Authored-By。
- 兩振出局：同一任務驗收失敗兩次就停手回報。
- 完成後把 DEV_PLAN 的狀態改成 `✅ 已驗收`；撤銷時照回滾方式做並改 `↩ 已回滾`。
- `git push` 由 Aki 在終端機自行執行（本工作階段的權限不允許代理 push）。
