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
