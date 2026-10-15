# 預覽前台：裝置矩陣、a11y／效能稽核、nginx 驗收

本檔說明怎麼在本機驗證 `apps/storefront` 的靜態匯出（`apps/storefront/out`）。全部只碰本機的
`127.0.0.1:3070-3079`，不連 VPS、不連 Mac mini 正式堆疊。

## 1. 裝置矩陣（P11-02a，`e2e/`，Playwright 1.64.1）

`e2e/` 是一個 pnpm 工作區套件（`@drn/e2e`），只有 devDependency `@playwright/test@1.64.1`
（`npm view @playwright/test version` 與 `npm view playwright version` 於 2026-10-15 皆為 1.64.1）。

### 1.1 前置

1. `pnpm install --frozen-lockfile`
2. 匯出前台：`pnpm --dir apps/storefront exec next build`（寫入 `apps/storefront/out/`；沒有
   `out/index.html` 時 `e2e/playwright.config.ts` 直接報錯，不會「綠在空集合上」）。
3. 安裝瀏覽器（只要一次；版本跟著 `@playwright/test`）：
   - Mac mini：瀏覽器放在 `~/drn` 底下（CLAUDE.md §1b 只允許寫 `~/drn/**`）：
     `PLAYWRIGHT_BROWSERS_PATH=$HOME/drn/pw-browsers pnpm --dir e2e exec playwright install chromium webkit firefox`
   - 其他機器：`pnpm --dir e2e exec playwright install chromium webkit firefox`（預設快取位置）
   - CI（ubuntu-24.04）：`.github/workflows/ci.yml` 的 `e2e` 工作用 `--with-deps` 一併裝系統套件。

`PLAYWRIGHT_BROWSERS_PATH` 已列入 docs/ENV.md（Playwright 自己讀，程式不讀）。

### 1.2 執行

| 用途 | 指令 |
|---|---|
| 全部 7 個 project | `pnpm --dir e2e test`（＝`playwright test`） |
| 只跑一個 project | `pnpm --dir e2e exec playwright test --project webkit-iphone14` |
| 列出測試（不執行） | `pnpm --dir e2e exec playwright test --list`（37 個） |
| 經由總入口 | `bash scripts/test-all.sh`（`e2e:storefront-matrix` 在 env-names 之後、storefront:build 之後執行） |

靜態伺服器由 Playwright 的 `webServer` 自己啟動：`python3 -m http.server 3071 --bind 127.0.0.1
--directory apps/storefront/out`，每次重新啟動（`reuseExistingServer: false`），3071 已被占用就直接失敗，
不會打到別人的伺服器。TODO(需查證)：此 repo 沒有 docs/server-inventory.md，3071（以及第 2 節的 3072）
要在盤點表補一列。

`E2E_BASE_URL`（docs/ENV.md）可改打別的站，此時不啟動本機伺服器；預覽站有 Basic Auth，本套件目前
沒有處理帳密，所以只適用於不需要密碼的站。

`scripts/test-all.sh` 在 `CI` 有設定時略過這一組（印出 `↷ e2e:storefront-matrix runs in the CI e2e job`），
因為 CI 的 `e2e` 工作會自己 build 並執行；storefront:build 失敗時這一組直接記為失敗。Mac mini 上未設
`PLAYWRIGHT_BROWSERS_PATH` 而 `~/drn/pw-browsers` 存在時，test-all 會自動帶上它。

### 1.3 七個 project

| project | 引擎 | 裝置 | 跑哪些測試 |
|---|---|---|---|
| chromium-desktop | Chromium | 1280×800 | 共用＋@motion＋@once（連結） |
| webkit-desktop | WebKit | 1280×800 | 共用＋@motion |
| firefox-desktop | Firefox | 1280×800 | 共用＋@motion |
| chromium-iphone14 | Chromium | iPhone 14（390×664，觸控） | 共用＋@motion＋@mobile |
| webkit-iphone14 | WebKit | iPhone 14 | 共用＋@motion＋@mobile |
| chromium-pixel7 | Chromium | Pixel 7 | 共用＋@motion＋@mobile |
| chromium-reduced-motion | Chromium | 1280×800，`prefers-reduced-motion: reduce` | 共用＋@reduced |

### 1.4 斷言（`e2e/tests/`）

斷言只看行為（computed position、GSAP 寫入的 scaleY、`data-active`），不看像素位置，因為版面還在改。
「在頂端」一律容許 0～64px（行動版頂列）。

- 首頁載入：往下走完整頁後 `canvas` 數為 3；`scrollWidth - innerWidth <= 0`；console error 與未捕捉例外為 0。
- @motion 01 hero：在 01 的釘住區間（`#s01` 到 `#s02` 的 30%、80% 處）`#s01` 為 `position: fixed`、top 0～64。
- @motion 02 階梯：一開始最低的柱子 scaleY < 0.5；`#s02` 捲到頂時每根柱子 scaleY ≥ 0.99。
- @motion 03：在 `#s03` 之後 0.5／1.5／2.5 個視窗高，`data-active` 依序為 0→1→2，再往回捲 1.5／0.5 回到 1→0；
  每一點 `#s03 .three` 都是 `fixed`、top 0～64。
- @reduced：沒有 `html.fx`、`#s01` 與 `#s03 .three` 不會 fixed、沒有 `.pin-spacer`，canvas 仍為 3。
- @mobile：頂列「選單」按下前 `/products/` 連結不可見，按下後可見。
- 404：`/404.html` 回 200、標題含 `Dr.Nature`、`h1` 含「找不到」。
- @once 連結：側欄、頂列選單、頁尾所有站內連結（去掉 `#` 與查詢字串，至少 11 條）對靜態伺服器都回 200。

### 1.5 這組測試不能證明什麼

- 看起來對不對：還沒有截圖基準（Playwright 的截圖基準綁瀏覽器＋作業系統，要等 CI 有產生基準的流程）。
- 真手機的 GPU、Safari 的實機行為：iPhone 14／Pixel 7 是桌機引擎的模擬（viewport、UA、觸控、DPR）。
- 網路字型：對其他主機（Google Fonts）的請求一律回空白 200，讓測試不依賴網路，所以證明不了字型載得到。
- nginx 的 `try_files` 與 python 伺服器是否一致（連結測試用的是 python）。
- 後端、購物車、結帳（P11-02b，等 P7-05）。
- CI 上 WebKit／Firefox 在 ubuntu-24.04 無 GPU 時能否建立 WebGL：本機（macOS）已驗證，CI 尚未執行過。

### 1.6 反向測試（CLAUDE.md §4，2026-10-15 實跑）

- 斷言改成 canvas 數 4 → `✘ … Expected: 4 Received: 3`，離場碼 1。
- spec 第一行插入 `throw new Error('drn P11-02a broken')` → 載入期錯誤，離場碼 1。
- 把匯出 JS 裡 hero 的 `pin:!0` 改成 `pin:!1`（暫存複本，經 `E2E_BASE_URL` 指過去）→ 只有 hero 測試紅，離場碼 1。

### 1.7 回滾

`git revert` 該提交；刪除瀏覽器快取只刪 drn 自己的目錄：`rm -rf ~/drn/pw-browsers`。

## 2. a11y／效能稽核（PERF-07／PF-04，`scripts/audit-storefront.sh`，手動關卡）

```
pnpm --dir apps/storefront exec next build
bash scripts/audit-storefront.sh                  # 預設：--out apps/storefront/out --port 3072 --lcp-budget-ms 4000 --cls-budget 0.1
bash scripts/audit-storefront.sh --lcp-budget-ms 2500   # PF-02／PF-03 完成後改用 DEV_PLAN 目標
```

- 工具版本釘死、用 `npx --yes` 取得（不進 repo、不進 lockfile）：`@axe-core/cli@4.13.0`（2026-08-11 發佈）、
  `lighthouse@13.5.0`（2026-09-18 發佈），2026-10-15 以 `npm view` 確認。
- 需要本機安裝 Google Chrome。`@axe-core/cli` 會拉「最新版」chromedriver，Chrome 版本必須相符
  （2026-10-15：chromedriver 155.0.1 對 Chrome 155.0.8059.79）；不相符時 axe 不會產出結果，腳本離場碼 2。
- 伺服器：腳本自己在 `127.0.0.1:<port>` 起一個模仿 PF-01 之後 nginx 的靜態伺服器（gzip、`/_next/static/` immutable、
  不存在的路徑回 `404.html`）。port 已被占用就離場碼 2。報告寫在新的暫存目錄（`$TMPDIR/drn-audit-storefront.*`），
  不寫進 repo。
- 判定（數字一律印出）：
  1. axe-core（Chrome headless、載入後等 4 秒）掃 `out/**/index.html` 每一頁：impact 為 serious 或 critical 的違規 > 0 → 失敗。
  2. Lighthouse 行動版（預設設定：模擬節流）跑 `/` 與 `/products/daily/`：LCP > `--lcp-budget-ms`、CLS > `--cls-budget`、
     或有任何對 `fonts.googleapis.com` 的請求 → 失敗。
- 離場碼：0 全過；1 有判定失敗；2 參數錯誤、沒有 build、port 被占用、工具沒有產出結果（不會「綠在空集合上」）。

**為什麼不接進 `scripts/test-all.sh`**：需要本機 Chrome 與網路（npx 下載兩個工具，axe 另拉 chromedriver），
跑一次約 2 分鐘，Lighthouse 的時間數字在不同機器、不同次之間會浮動，放進總入口會讓 CI 與本機時紅時綠。
它是 a11y／效能任務（AC-*、PF-*、P7-02／P7-07／P7-08／P11-04／P11-05）的驗收指令，由執行任務的人手動跑。

**2026-10-15 基準（commit 7fba83b 的匯出，本機 Mac）**：離場碼 1。
axe：22 頁中 13 頁有 serious（`/` 有 aria-prohibited-attr、color-contrast ×5、scrollable-region-focusable；
其餘多為 color-contrast），critical 0。Lighthouse 行動版：`/` LCP 8946 ms、CLS 0.000、fonts.googleapis.com 1 次、
效能分數 67；`/products/daily/` LCP 8522 ms、CLS 0.000、fonts.googleapis.com 1 次、分數 74。

**反向測試（2026-10-15 實跑）**：用一個乾淨的兩頁假站（`--out <暫存目錄>`）→ 離場碼 0（axe 0／0，LCP 753／642 ms）；
同一假站加 `--lcp-budget-ms 1` → 離場碼 1（`lcp:/ lcp:/products/daily/`）；把跳到主要內容連結的文字拿掉 →
`link-name(serious,1)`、離場碼 1；`--out /nonexistent`、未知參數、port 被占用 → 離場碼 2。

這支腳本不能證明：鍵盤操作與螢幕報讀的實際體驗（axe 只抓得到約兩到五成的問題）、真手機上的速度
（Lighthouse 是模擬節流）、正式站經過 Cloudflare／nginx 後的數字。

## 3. nginx：gzip 與 `/_next/static/` 長快取（PERF-01／PF-01，`infra/nginx/drn.conf`）

改動只在 drn 的 443 `server` 區塊內（CLAUDE.md §1.3）：`gzip on; gzip_comp_level 5; gzip_min_length 1024;
gzip_vary on; gzip_types text/css application/javascript text/javascript application/json image/svg+xml text/plain;`
（text/html 在 gzip 開啟時一律壓縮），以及 `location ^~ /_next/static/`：`Cache-Control: public, max-age=31536000,
immutable`，並重寫 `X-Robots-Tag`、`X-Content-Type-Options`（`add_header` 只有在該層沒有任何 `add_header`
時才繼承上層；`auth_basic` 照常繼承，靜態檔仍需密碼）。指令的 context 與繼承規則依 nginx 官方文件
（ngx_http_gzip_module、ngx_http_headers_module，2026-10-15 查）；`next start` 對 `/_next/static/` 送的也是同一個
Cache-Control（next 16.4.0 `dist/server/lib/router-server.js`）。

**本機無法跑 `nginx -t`**：這台 Mac 沒有 nginx 執行檔，Docker 依 CLAUDE.md §1b 不可用；只做了結構檢查
（大括號平衡、每行以 `;`／`{`／`}` 結尾、新指令都在第二個 server 區塊）。`nginx -t` 由部署腳本在 VPS 上執行。

### 3.1 部署（Aki 執行；CODE 不碰 VPS、不讀金鑰與 htpasswd）

```
pnpm --dir apps/storefront exec next build
bash infra/vps/drn-preview-deploy.sh <ssh-key-path> <htpasswd-file>
```

腳本會先備份 `/opt/drn/drn.conf.prev`、`nginx -t` 通過才 `systemctl reload nginx`；`nginx -t` 因 drn.conf 失敗時自動還原、
不重載；因其他檔案失敗時停手（CLAUDE.md §1.9）。回滾見腳本檔頭（`drn.conf.prev` 裝回、`nginx -t`、reload）。

### 3.2 部署後驗收（curl；`-u <預覽帳號>` 只給帳號，curl 會在終端機問密碼，不留在指令歷史）

```
# 1) 找出 three.js 那支 chunk（含 WebGLRenderer 的檔案裡最大的一支；以部署的同一個 build 為準）
CHUNK=$(basename "$(ls -S $(grep -l WebGLRenderer apps/storefront/out/_next/static/chunks/*.js) | head -1)")

# 2) 靜態檔：gzip、一年 immutable、noindex 仍在（用 GET 讀標頭並量實際傳輸位元組）
curl -s -u <預覽帳號> -H 'Accept-Encoding: gzip' -D - -o /dev/null \
  -w 'size_download=%{size_download}\n' "https://dr.nature.smilelife.tw/_next/static/chunks/$CHUNK" \
  | tr -d '\r' | grep -iE '^(HTTP/|content-encoding|cache-control|vary|x-robots-tag|x-content-type-options)|size_download'

# 3) HTML 沒帶密碼仍是 401，且有 noindex
curl -sI https://dr.nature.smilelife.tw/ | tr -d '\r' | grep -iE '^(HTTP/|www-authenticate|x-robots-tag)'

# 4) HTML 帶密碼：gzip，但沒有 immutable
curl -s -u <預覽帳號> -H 'Accept-Encoding: gzip' -D - -o /dev/null https://dr.nature.smilelife.tw/ \
  | tr -d '\r' | grep -iE '^(HTTP/|content-encoding|cache-control|x-robots-tag)'
```

預期：
- (2) 狀態 200、`content-encoding: gzip`、`cache-control: public, max-age=31536000, immutable`、`vary: Accept-Encoding`、
  `x-robots-tag: noindex, nofollow`、`x-content-type-options: nosniff`，`size_download` ≤ 190000。
  參考值（2026-10-15 本機 build，three chunk `3axxox4dx8k5w.js`）：原始 737,025 B，`gzip -5` 186,573 B；
  全部 JS 1,463,301 B → 423,756 B。nginx 的壓縮結果與 gzip 指令列工具可能差幾百位元組。
- (3) 狀態 401、`www-authenticate: Basic realm="Dr.Nature preview"`、`x-robots-tag: noindex, nofollow`。
- (4) 狀態 200、`content-encoding: gzip`、沒有 `immutable`、`x-robots-tag` 仍在。

回滾：見 3.1；本機 `git revert` 該提交後重新部署。
