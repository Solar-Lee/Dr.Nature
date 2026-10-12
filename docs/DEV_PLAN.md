# Dr.Nature 總開發計畫（Master Dev Plan）v1

> 主導：CODE（Claude Code）｜協作：DESIGN（Claude Design）｜決策與帳號：USER（Aki）
> 建立：2026-10-13。守則：[CLAUDE.md](../CLAUDE.md)。設計交接：[handoff/DESIGN_BRIEF.md](handoff/DESIGN_BRIEF.md)。環境變數：[ENV.md](ENV.md)。
> 狀態圖例：`⬜ 未開始`｜`🟡 進行中`｜`⛔ 卡關（等前置或 USER）`｜`✅ 已驗收`｜`↩ 已回滾`

---

## 1. 目標

以最快速度搶佔台灣電商與團購保健品市場：上線一個**高端、可信、合規**的品牌官網（含購物、會員、分潤賣場、SEO 內容），並把團購招商、客服、廣告接到 Aki **既有**的系統上，不重造輪子。

成功的定義（上線閘門 G-LAUNCH 全部打勾才算）：
1. 正式站 `https://dr.nature.smilelife.tw` 可完成「瀏覽 → 加入購物車 → 綠界付款 → 超商取貨／宅配 → 開立電子發票 → 訂單通知（Email＋簡訊）」全流程，並有一筆真實訂單驗證過（之後退款）。
2. 三款益生菌商品頁的所有文案通過 `docs/compliance/claims.md` 檢核。
3. 團購系統已能對 Dr.Nature 開團、歸因、結算。
4. 主機上 58 個既有容器、65 個 nginx 站台在部署前後完全一致。

## 2. 已定案的決策（2026-10-13，Aki 核准）

| # | 決策 | 理由 |
|---|---|---|
| A1 | 電商核心：**Medusa v2**（npm 最新 2.21.2，查證於 2026-10-13）＋ **Next.js** 前台 | 購物車、促銷、客群、RBAC（2.15.5 起）、後台都是內建；自架、資料自有 |
| A2 | 金流／物流／發票：**綠界 ECPay**（先用官方測試環境，正式金鑰由 Aki 申請） | 一次整合信用卡、ATM、超商代碼、Apple Pay、超商取貨、電子發票 |
| A3 | 部署：**混合式**——前台 Vercel；Medusa server＋worker＋Redis 在 VPS（映像在 Mac 建好再傳）；Postgres＋檔案儲存在**新建的專屬 Supabase 專案** | VPS 磁碟 97%、CPU 近滿載；前台需要 CDN 承載影片與 3D |
| A4 | 設計交接走 GitHub repo：DESIGN 產出放 `design/` | 單一真實來源、可版控 |
| A5 | **不重造既有系統**：團購招商／寄樣／結算 → tuangou-admin（新增品牌 `drnature`）；全通路客服 → OmniCS（站內嵌 widget）；廣告 → DigiAds；站外 SEO → Dr.Grey | 這些系統已在正式環境運作（盤點見 §4） |

## 3. 系統架構

```
瀏覽器
  │
  ├─▶ Vercel：apps/storefront（Next.js）  https://dr.nature.smilelife.tw
  │       │  伺服器端呼叫（publishable key）
  │       ▼
  ├─▶ VPS nginx（新增 drn.conf）  https://api.dr.nature.smilelife.tw
  │       ├─ drn-backend  127.0.0.1:3961  Medusa server + Admin（/app）
  │       ├─ drn-worker   （不對外）       排程、訂閱者、通知
  │       └─ drn-redis    （僅 drn_net）
  │
  ├─ Supabase（新專案 drn-prod）：Postgres、Storage（S3 相容，商品圖）
  ├─ ECPay：付款／物流／發票 ⇄ 後端 webhook /hooks/ecpay/*
  ├─ 簡訊商：後端 Notification provider（SMS）
  ├─ OmniCS：/widget.js 站內客服；LINE／FB／IG／Email 統一收件匣
  ├─ LINE OA @704vmtun：webhook 歸屬待裁決（閘門 G3）
  ├─ tuangou-admin：KOL 招商、寄樣、/k/<token> 成效頁、結算（gmv_source=manual，由本站匯出每位 KOL 的 GMV）
  ├─ DigiAds／Meta：Pixel（前端）＋ Conversions API（前台伺服器端）
  └─ Dr.Grey：站點 SEO 稽核＋內容產製（手動發佈到本站 Blog）
```

Monorepo（pnpm workspace）：

```
apps/backend        Medusa v2（自訂模組：blog、affiliate、sms、ecpay-payment、ecpay-fulfillment、ecpay-invoice、tier）
apps/storefront     Next.js（App Router）
packages/tokens     由 design/tokens/tokens.json 產生 CSS 變數與 Tailwind 主題（不手抄）
content/            所有文字的單一真實來源（品牌、產品、法規標示）
design/             DESIGN 交付物
e2e/                Playwright
infra/              docker-compose.prod.yml、nginx drn.conf、部署與備份腳本
docs/               計畫、研究、法規、交接；docs/private/（gitignored，主機盤點）
```

## 4. 既有系統整合對照（防重工）

來源：2026-10-13 唯讀盤點（各專案 README／docs，路徑見 `docs/private/`）。

| 需求 | 既有系統 | 本專案只做 |
|---|---|---|
| KOL 招商、寄樣、出貨、檔期提醒 | tuangou-admin（多品牌，`bin/tuangou brand onboard <slug>`；cron 依品牌排程） | 提供品牌設定與商品資料；新品牌接入照該專案 Runbook |
| KOL 成效頁、分潤結算 | tuangou-admin `/k/<token>`、`/api/settle/runs/<id>/gmv`（`gmv_source=manual`，輸入每位 KOL 的 GMV 總額） | 後台匯出「每位分潤夥伴 GMV／訂單數」（CSV＋唯讀 API），格式對齊 `{kol, gmv, orders}` |
| LINE／FB／IG／Email／站內客服 | OmniCS（omnics.smilelife.tw，`/widget.js`、`/api/v1`、對外 webhook） | 嵌入 widget；訂單事件推送 OmniCS **目前沒有接收端點**（只有 GET），列為跨專案需求 X1 |
| 廣告投放與 ROAS | DigiAds（要求 Meta Pixel、CAPI、GA4、GSC；UTM 慣例 `utm_source=meta`、`utm_source=line&utm_medium=oa_push`） | 埋 Pixel／GA4／GTM；前台伺服器端送 CAPI；保留 UTM 到訂單 metadata |
| 站外 SEO、內容產製 | Dr.Grey／AutoSEO（稽核 robots、sitemap index、canonical 轉址、hreflang＋x-default、`/products/` 的 Product/Offer JSON-LD、Article 結構化資料） | 前台必須通過這份稽核清單；文章以手動模式發佈到本站 Blog |
| 簡訊 | **無**（所有既有系統都沒有） | 新建 SMS notification provider |
| 會員、購物車、促銷、後台、RBAC | Medusa 內建 | 設定＋少量擴充（等級引擎） |

## 5. 決策閘門（未過不得進入下一階段）

| 閘門 | 內容 | 誰決定 | 狀態 |
|---|---|---|---|
| G1 | 部署架構 | Aki | ✅ 混合式（2026-10-13） |
| G2 | 產品名稱與功效用詞（日日順／晶亮／舒敏 是否保留；一般食品或申請健康食品） | Aki（CODE 依法規研究提案） | ⏳ 提案已出：[product/naming-proposal.md](product/naming-proposal.md) |
| G3 | LINE OA webhook 歸屬：① 招商期給 `drnature_bot`（團購既有模式，鏡射到 tuangou 即時收件匣）② 給 OmniCS（消費者客服）③ 寫轉發器同時送兩邊 | Aki | ⬜ |
| G4 | 視覺方向三選一（D-01）、Monogram 三選一（D-02） | Aki | ⬜ |
| G5 | 品牌故事／Slogan 三選一（P1-03、P1-04） | Aki | ⬜ |
| G6 | 付費素材生成批次核准（每批列出張數與點數） | Aki | ⬜ |
| G7 | 正式上線（G-LAUNCH 清單全綠） | Aki | ⬜ |

## 6. USER（Aki）待辦——只有你能做的事

| 編號 | 事項 | 擋住 |
|---|---|---|
| U-01 | **輪替已外露的憑證**：LINE OA Channel secret／Access token（曾寫在 Pages 檔）；`3. Key/key.md` 內與本專案無關的金鑰另存他處 | 安全 |
| U-02 | 申請綠界特店（金流＋物流＋電子發票），取得正式金鑰後親手寫入主機 `.env` | P4 正式切換 |
| U-03 | 選定簡訊商（建議三竹 Mitake 或 Every8d）並開通帳號 | P8 簡訊 |
| U-04 | Vercel：建立或指定團隊（商用需 Pro）；Supabase：核准建立新專案 `drn-prod`（Pro，避免閒置暫停） | P0-08、P0-09 |
| U-05 | DNS：`dr.nature.smilelife.tw` 改 CNAME 到 Vercel；新增 `api.dr.nature.smilelife.tw` A 記錄 → 151.145.69.134（DNS only，不走代理） | P12 |
| U-06 | GS1 Taiwan 申請商品條碼（EAN-13），三個 SKU 各一 | P2 包裝定稿 |
| U-07 | 食品業者登錄字號（非登）、產品責任險、委託製造廠資料（廠名、地址、許可） | 標示定稿 |
| U-08 | 菌株資料：每款的菌種學名、菌株編號、每顆含菌數、原料供應商文件、檢驗報告 | 產品文案、標示 |
| U-09 | 交易信服務選定（訂單確認、出貨通知） | P8 |
| U-10 | 定義或核准會員等級門檻（CODE 會先提案） | P5 |
| U-11 | Meta Business：Pixel 與 CAPI token；GA4、GTM、Search Console 權限 | P8 |
| U-12 | 研發長肖像與名義使用的書面同意（官網、廣告、包裝） | P7 信任區塊 |

## 7. 任務清單（最小執行單位）

每列都有驗收與回滾；開始前若欄位不夠具體，先補齊再動手。`C`=CODE、`D`=DESIGN、`U`=USER。

### P0 治理與基礎

| ID | 任務 | 負責 | 前置 | 驗收（指令 → 預期） | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P0-01 | 寫專案守則 CLAUDE.md | C | — | `grep -c '^[0-9]\.' CLAUDE.md` ≥ 9 條隔離守則 | 刪檔 | ✅ |
| P0-02 | 主機唯讀盤點 → `docs/private/server-inventory.md` | C | — | 檔案含容器、網路、port、nginx、排程、RAM、磁碟 | 刪檔 | ✅ |
| P0-03 | `docs/private/do-not-touch.md`（由盤點產生禁觸清單） | C | P0-02 | 容器數＝盤點數（58）、nginx 數＝65 | 刪檔 | ✅ |
| P0-04 | 環境變數白名單 `docs/ENV.md` ＋ `.env.example` | C | — | `.env.example` 的每個名稱都出現在 ENV.md（腳本比對，差集為空） | 刪檔 | ✅ |
| P0-05 | 設計交接單 `docs/handoff/DESIGN_BRIEF.md` ＋ `design/` 骨架 | C | — | 檔案存在；Aki 轉交 DESIGN | 刪檔 | ✅ |
| P0-06 | Monorepo 骨架：`pnpm-workspace.yaml`、根 `package.json`、`.nvmrc`（Node 22 LTS，Medusa 要求 `^20.19 \|\| >=22.12`） | C | — | `pnpm install --frozen-lockfile` 離場碼 0 | `git revert` | ✅ |
| P0-07 | 可信的測試入口 `scripts/test-all.sh`：萬用字元找測試、判離場碼、併 stderr、任一失敗即失敗 | C | P0-06 | 故意放一支斷言失敗、一支載入期崩潰的測試 → 兩次都離場碼 ≠ 0；移除後 = 0 | `git revert` | ✅ |
| P0-08 | 建 Supabase 專案 `drn-prod`（區域：東京或新加坡）；記錄連線方式到 ENV（值由 Aki 填） | C＋U | U-04 | Supabase MCP `get_project` 回傳狀態 ACTIVE_HEALTHY | 刪專案（Aki） | ⛔ |
| P0-09 | Vercel 專案 `drn-storefront` 連 GitHub repo（root `apps/storefront`） | C＋U | U-04、P7-01 | Preview 部署成功、URL 回 200 | 刪專案 | ⛔ |
| P0-10 | GitHub Actions CI：install → lint → typecheck → `scripts/test-all.sh` → build | C | P0-07 | 開一個故意壞掉的 PR → CI 紅；修好 → 綠 | 刪 workflow | ⬜ |

### P1 品牌策略與文字（C）／視覺識別（D）

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P1-01 | 法規研究：一般食品允許例句、禁用詞、健康食品路徑、標示、代言規範 → `docs/research/regulatory.md`（每條附官方來源） | C | — | 每條規則都有來源網址；無來源者標「未驗證」 | 刪檔 | ✅ |
| P1-02 | 合規用詞表 `docs/compliance/claims.md` ＋ 自動掃描腳本 `scripts/claims-lint.mjs`（掃 `content/` 與前台字串） | C | P1-01 | 放一句「改善便秘」到測試檔 → 腳本離場碼 ≠ 0 | `git revert` | ✅ |
| P1-03 | 品牌故事／精神／語調 3 版 → 迭代 → 推薦 1 版 `content/brand/story.md` | C | P1-02 | 三版並列＋評分表；全文過 claims-lint | `git revert` | ⬜ |
| P1-04 | Slogan 3 版 → 推薦 1 版 `content/brand/slogan.md` | C | P1-02 | 同上；中英各一 | `git revert` | ⬜ |
| P1-05 | 研發長查證頁 `docs/research/cro.md`：只收錄來源網頁實際寫到的經歷 | C | — | 每一句有來源；論文、專利未查證者標「未驗證」 | 刪檔 | ✅ |
| P1-06 | 市場與競品研究 `docs/research/market.md` | C | — | 價格、通路數字都有來源 | 刪檔 | ✅ |
| P1-07 | 通路與行銷策略 `docs/strategy/go-to-market.md`（官網、團購、平台、LINE、廣告；價格帶與團購價政策；90 天節奏） | C | P1-06、G2 | 每個數字可追溯到 market.md；策略項目標明「分析」而非事實 | `git revert` | ⬜ |
| D-01～D-03 | 視覺方向、Monogram、Design tokens | D | — | 見 DESIGN_BRIEF §5 | — | ⬜ |
| P1-08 | 驗收 D-03：tokens.json → `packages/tokens` 產生 CSS 變數與 Tailwind 主題（Style Dictionary） | C | D-03 | `pnpm --filter tokens build` 零錯誤；對比檢查腳本全部 AA | `git revert` | ⛔ |

### P2 產品、規格、包裝

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P2-01 | 產品命名定案（三款）＋系列名 → `content/products/index.md` | C | G2 | 名稱過 claims-lint；Aki 核准 | `git revert` | ⛔ |
| P2-02 | 編碼邏輯 `docs/product/sku-coding.md`：SKU（例：`DN-PB-01-060C`＝品牌-系列-品項-規格）、批號（例：生產日 `YYMMDD`＋產線碼）、條碼（GS1） | C | — | 規則可由腳本驗證（regex 測試通過） | `git revert` | ⬜ |
| P2-03 | 規格指南 `docs/product/guidebook.md`：每款的菌種／菌株（待 U-08）、每顆含量、建議食用量、保存、效期、過敏原、素食標示、包裝規格（60 顆／瓶、100ml PE/PP 瓶、50×50×100 外盒） | C | U-08 | 未取得的欄位標 `待 U-08`，不得填推測值 | `git revert` | ⛔ |
| P2-04 | 法定標示文字 `content/products/<sku>/label.md`（品名、內容物、淨重、廠商、原產地、有效日期、營養標示、過敏原、注意事項…） | C | P2-01、P2-03、U-07 | 對照 regulatory.md 標示清單逐項打勾 | `git revert` | ⛔ |
| P2-05 | 產品頁文案 `content/products/<sku>/copy.md`（名稱、副標、介紹、使用方式、FAQ） | C | P2-01、P1-02 | claims-lint 綠 | `git revert` | ⛔ |
| D-07 | 貼標、外盒、品牌小卡設計 | D | D-02、P2-04 | DESIGN_BRIEF §5 第 5 條 | — | ⛔ |
| P2-06 | 印刷前核對：條碼可掃、標示完整、尺寸對刀模 | C＋U | D-07、U-06 | 逐項清單全部打勾、Aki 簽核 | 退回 D | ⛔ |

### P3 後端：Medusa 核心

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P3-01 | 建 `apps/backend`（`create-medusa-app` 對應 2.21.x；版本查證寫進提交訊息） | C | P0-06 | 本機 `docker compose up` 後 `curl :9000/health` → `OK` | `git revert` | ⬜ |
| P3-02 | 本機開發用 `infra/docker-compose.dev.yml`（postgres:16-alpine、redis:7-alpine） | C | P3-01 | `docker compose ps` 三個服務 healthy | `docker compose down -v`（僅本機） | ⬜ |
| P3-03 | 區域與幣別：Taiwan region、TWD、含稅價（5% 營業稅內含） | C | P3-01 | 整合測試：建立購物車 → 金額為含稅整數 TWD | `git revert` | ⬜ |
| P3-04 | 商品資料種子 `apps/backend/src/scripts/seed.ts`：3 SKU、價格 1,150、庫存、圖片佔位 | C | P3-03、P2-02 | `medusa exec seed` 後 Store API 列出 3 件商品 | 重建資料庫 | ⬜ |
| P3-05 | 銷售通路：官網、團購（分潤賣場）兩個 sales channel＋各自 publishable key | C | P3-04 | Store API 以不同 key 查詢，商品集合符合設定 | `git revert` | ⬜ |
| P3-06 | 檔案儲存改 S3 provider（Supabase Storage） | C | P0-08 | 後台上傳圖片 → 公開 URL 回 200 | 改回 local provider | ⛔ |
| P3-07 | 後台 RBAC：角色「管理員／營運／客服／內容編輯／財務」與權限（`rbacRole`、`rbacPolicy`，2.15.5 起） | C | P3-01 | 整合測試：內容編輯角色呼叫商品刪除 API → 403 | `git revert` | ⬜ |

### P4 ECPay 金流／物流／發票

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P4-01 | 查證 ECPay 目前版 API 文件（AIO 金流、物流、B2C 電子發票）→ `docs/research/ecpay.md`（端點、CheckMacValue 演算法、測試帳號取得方式、回傳格式） | C | — | 每個端點附官方文件網址 | 刪檔 | ⬜ |
| P4-02 | CheckMacValue 純函式＋單元測試（用官方文件範例向量） | C | P4-01 | 官方範例輸入 → 官方範例輸出，完全相同 | `git revert` | ⬜ |
| P4-03 | Payment provider `ecpay`：建立付款（導轉表單）、`getWebhookActionAndData`（驗章失敗一律 failed）、退款 | C | P4-02 | 測試環境：信用卡測試卡付款 → 訂單狀態 captured；竄改 CheckMacValue 的回呼 → 拒絕且不改訂單 | 停用 provider | ⬜ |
| P4-04 | 付款方式：信用卡、ATM、超商代碼、Apple Pay（依 ECPay 測試環境實際支援為準） | C | P4-03 | 每種方式在測試環境走完一次，截圖存 `e2e/evidence/` | 停用該方式 | ⬜ |
| P4-05 | Fulfillment provider `ecpay-logistics`：7-11／全家／萊爾富超商取貨（電子地圖選店）、宅配 | C | P4-01 | 測試環境：選店 → 建物流單 → 取得托運單號 | 停用 provider | ⬜ |
| P4-06 | 電子發票：付款成功後開立（載具：手機條碼／自然人憑證／會員；捐贈碼；統編） | C | P4-03 | 測試環境開立 → 回傳發票號碼寫入訂單 metadata；作廢流程測一次 | 停用訂閱者 | ⬜ |
| P4-07 | 冪等與對帳：同一回呼重送兩次只入帳一次；每日對帳腳本 | C | P4-03 | 測試：同一 payload 重送 → 第二次 no-op | `git revert` | ⬜ |

### P5 會員、等級、促銷

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P5-01 | 會員登入：Email＋密碼、Google、LINE Login | C | P3-01 | e2e：三種方式各登入成功 | 停用 provider | ⬜ |
| P5-02 | 會員等級提案 `docs/strategy/membership.md`（門檻、權益、降級規則） | C | P1-07 | Aki 核准（U-10） | — | ⬜ |
| P5-03 | 等級引擎：訂單完成／退款訂閱者 → 重算近 12 個月消費 → 移動客群（customer group） | C | P5-02 | 整合測試：跨門檻訂單 → 升級；退款跌破 → 降級 | 停用訂閱者 | ⛔ |
| P5-04 | 等級專屬促銷：以 `customer.group.id` 規則建立促銷 | C | P5-03 | 整合測試：非該等級的購物車套用 → 不折抵 | 停用促銷 | ⛔ |
| P5-05 | 活動促銷範本：滿額折、第二件折、買 X 送 Y、免運、限時、預算上限的 campaign | C | P3-04 | 每種範本一支整合測試 | 停用促銷 | ⬜ |

### P6 內容：Blog 與 SEO

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P6-01 | Blog 自訂模組：Post、Category、Tag；`type`＝pillar／cluster；cluster 指向 pillar；SEO 欄位（meta title、meta description、canonical、OG 圖、noindex）、作者、發佈／更新時間 | C | P3-01 | 整合測試：建 pillar＋2 cluster → API 回傳互相連結 | 移除模組＋遷移回退 | ⬜ |
| P6-02 | 後台編輯介面（Admin UI route）：Markdown 編輯、預覽、排程發佈；權限只給內容編輯以上 | C | P6-01、P3-07 | e2e：內容編輯建文 → 前台出現 | 移除 route | ⬜ |
| P6-03 | 前台 Blog：首頁、分類頁、pillar 頁（自動列 cluster）、文章頁（H1 唯一、目錄、麵包屑） | C | P6-01、D-05 | Lighthouse SEO = 100；每頁剛好一個 `<h1>` | `git revert` | ⛔ |
| P6-04 | 結構化資料：Organization、WebSite、Product＋Offer（`/products/`）、Article、BreadcrumbList、FAQPage | C | P6-03、P7-04 | Google Rich Results Test（或 schema 驗證腳本）零錯誤 | `git revert` | ⛔ |
| P6-05 | `robots.txt`、sitemap index（商品、文章、分類分開；不含 utm 與私人頁）、canonical、`hreflang="zh-TW"`＋`x-default`、`<html lang="zh-Hant-TW">` | C | P6-03 | 依 Dr.Grey 稽核清單逐項腳本檢查全綠 | `git revert` | ⛔ |
| P6-06 | 發佈 webhook：文章或商品更新 → 呼叫前台 revalidate | C | P6-02 | 改文章標題 → 60 秒內前台更新 | 停用訂閱者 | ⛔ |

### P7 前台 Storefront

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P7-01 | 建 `apps/storefront`（Next.js 最新穩定版；版本查證寫進提交），接 `packages/tokens` | C | P0-06、P1-08 | `pnpm --filter storefront build` 離場碼 0 | `git revert` | ⛔ |
| P7-02 | 基礎版型：Header、Footer、導覽、購物車抽屜、Toast、Skip link | C | D-04、D-05 | Playwright 無障礙掃描（axe）零嚴重問題 | `git revert` | ⛔ |
| P7-03 | 商品列表頁 | C | P3-04、D-05 | e2e：列出 3 件商品、價格 NT$1,150 | `git revert` | ⛔ |
| P7-04 | 商品頁 PDP（文案取自 `content/`，不在元件內寫死） | C | P2-05、D-05 | claims-lint 掃描建置後 HTML 全綠 | `git revert` | ⛔ |
| P7-05 | 購物車＋結帳三步驟（資料、配送／選店、付款）＋訂單完成頁 | C | P4-03、P4-05 | e2e（測試環境）：下單到完成頁 | `git revert` | ⛔ |
| P7-06 | 會員中心：訂單、物流狀態、發票、等級與權益、地址簿 | C | P5-01、P5-03 | e2e：登入 → 看到剛才的訂單 | `git revert` | ⛔ |
| P7-07 | 首頁 Hero 影片（`<video>`，poster、行動版／桌機版來源、`prefers-reduced-motion` 改靜態） | C | D-06、P10-03 | LCP（行動版模擬）≤ 2.5 s；reduced-motion 時不載入影片 | `git revert` | ⛔ |
| P7-08 | Scroll 互動敘事：依 `design/motion/scroll-scenes.json` 驅動（程式讀規格檔，不手抄數值） | C | D-06 | 規格檔每一幕都有對應測試（捲到該區間時元素狀態正確）；CLS ≤ 0.1 | `git revert` | ⛔ |
| P7-09 | 3D 產品：以 45.8×45.8×85.7 mm 建瓶身幾何、貼 D-07 wrap 圖；不支援 WebGL 時退回靜態圖 | C | D-06、D-07 | 停用 WebGL 的瀏覽器 → 顯示靜態圖且無錯誤 | `git revert` | ⛔ |
| P7-10 | 品牌頁、研發長頁、FAQ、法規頁（隱私、條款、退換貨、食品資訊）、404 | C | P1-03、P1-05、U-12 | 每頁有 meta 與 canonical；連結檢查零 404 | `git revert` | ⛔ |
| P7-11 | Landing Page 模板（活動用，可由後台選商品與文案） | C | D-05 | e2e：建一個活動頁 → 可下單 | `git revert` | ⛔ |
| P7-12 | 信任區塊：KOL／素人分享只接受後台上傳的真實素材，且強制顯示「廣告／合作」標記 | C | D-09 | 沒勾「已取得同意」的素材無法發佈（整合測試） | `git revert` | ⛔ |

### P8 整合

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P8-01 | SMS notification provider（`log`／所選簡訊商），事件：訂單成立、出貨、到店、等級變更；退訂機制 | C | U-03 | `SMS_PROVIDER=log` 時整合測試斷言送出內容；正式商由持有帳號者手動驗一次 | 改回 `log` | ⛔ |
| P8-02 | 交易信（訂單、出貨、到店、退款） | C | U-09 | 整合測試＋測試信箱實收一次 | 停用 | ⛔ |
| P8-03 | 嵌入 OmniCS widget（在 OmniCS 後台為 Dr.Nature 建品牌與網站通道） | C＋U | P7-02 | 前台送一則訊息 → OmniCS 收件匣出現 | 移除 script | ⛔ |
| P8-04 | GA4、GTM、Meta Pixel（含同意橫幅，預設拒絕非必要） | C | U-11 | GA4 DebugView 看到 `view_item`、`add_to_cart`、`purchase` | 移除標籤 | ⛔ |
| P8-05 | Meta CAPI（前台伺服器端，與 Pixel 以 `event_id` 去重） | C | P8-04 | Events Manager 測試事件顯示「已去重」 | 停用 | ⛔ |
| P8-06 | UTM 與來源保存到訂單 metadata（含 `sl-ref` 之外的本站 `ref` 參數） | C | P7-05 | e2e：帶 utm 下單 → 訂單 metadata 有值 | `git revert` | ⛔ |
| P8-07 | LINE OA webhook 依 G3 實作 | C | G3 | LINE 後台 webhook 驗證成功；訊息到達指定系統 | 恢復原 webhook URL | ⛔ |
| P8-08 | tuangou-admin 新增品牌 `drnature`（依該專案 Runbook：`brand onboard` → `validate` → `ingest products`；LINE bot 由 NATREES 範本複製） | C＋U | P2-05、G3 | 依該 Runbook 的離開條件 | 依該 Runbook | ⛔ |
| X1 | 跨專案需求（不在本 repo 實作）：OmniCS 新增訂單事件接收端點 `POST /api/v1/orders`；Dr.Grey 新增 Medusa／Next.js 發佈轉接器 | 另開工作階段 | — | — | — | ⬜ |

### P9 分潤獨立賣場

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P9-01 | Affiliate 模組：Partner（對應 tuangou KOL id／IG 帳號）、Store（`/s/<slug>`、選品、價格表、活動期間）、歸因（連結參數＋首方 cookie 30 天＋訂單 metadata） | C | P3-05 | 整合測試：透過 `/s/<slug>` 下單 → 訂單歸屬該 partner | 停用模組 | ⛔ |
| P9-02 | 賣場專屬價（price list 綁 sales channel）與粉絲折扣碼 | C | P9-01、P5-05 | 整合測試：賣場價只在該賣場生效 | 停用 price list | ⛔ |
| P9-03 | 每位 partner 的 GMV／訂單數匯出（後台 CSV＋`INTEGRATION_API_TOKEN` 唯讀 API），口徑：已付款、扣退款、不含運費（口徑寫進 `docs/strategy/affiliate.md` 並由 Aki 核准） | C | P9-01 | 對同一份測試資料，CSV 合計＝訂單手算合計 | `git revert` | ⛔ |
| P9-04 | 前台賣場頁（partner 頭像、選品、倒數、分享） | C | D-05、P9-01 | e2e：賣場頁可下單 | `git revert` | ⛔ |
| P9-05 | 與 tuangou 結算對接演練：匯出 → `POST /api/settle/runs/<id>/gmv` → 對帳單 | C＋U | P9-03、P8-08 | 演練一檔測試活動，金額一致 | — | ⛔ |

> 分潤**級距計算與 KOL 成效頁**一律在 tuangou-admin，本站不重做。

### P10 素材生成（付費，閘門 G6）

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P10-01 | 依 D-08 shot list 生成白底圖（以 D-07 包裝實際設計為輸入，不得虛構包裝） | C | D-07、D-08、G6 | DESIGN 選片紀錄 | — | ⛔ |
| P10-02 | 情境圖、模特圖（模特為生成人物，不得冒充真實人物或醫師） | C | P10-01、G6 | DESIGN 選片 | — | ⛔ |
| P10-03 | Hero 影片、產品動畫影片 | C | D-06、G6 | 檔案大小與規格符合 DESIGN_BRIEF §5 | — | ⛔ |
| P10-04 | 專利／新聞區素材：只排版真實報導（研發長新聞連結查證後） | C | P1-05 | 每則附原始網址 | — | ⛔ |

### P11 測試與品質閘門

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P11-01 | 單元＋整合測試入 `scripts/test-all.sh`（後端用全新資料庫跑全部遷移） | C | P0-07 | 反向測試：弄壞一個遷移 → 紅 | — | ⬜ |
| P11-02 | e2e smoke（Playwright）：首頁、商品頁、加入購物車、結帳到付款頁、Blog、登入；只讀模式可對正式站跑 | C | P7-05 | 本機與 staging 全綠；`E2E_ALLOW_WRITES` 未設時不建立訂單（測試斷言） | — | ⬜ |
| P11-03 | e2e 全流程（測試環境）：三種付款、兩種物流、發票、退款、等級升級、分潤歸因 | C | P4、P5、P9 | 全綠＋證據截圖 | — | ⛔ |
| P11-04 | 效能預算：行動版 LCP ≤ 2.5 s、CLS ≤ 0.1、INP ≤ 200 ms；首屏 JS ≤ 200 KB gzip | C | P7 | Lighthouse CI 斷言 | — | ⛔ |
| P11-05 | 無障礙：axe 零 serious／critical | C | P7 | Playwright＋axe | — | ⛔ |
| P11-06 | 資安：HawkScan DAST、相依套件稽核、webhook 驗章測試、速率限制 | C | P4、P8 | 零 High；webhook 竄改測試全部被拒 | — | ⛔ |
| P11-07 | 假綠稽核（false-green-audit 流程）：確認每道閘門壞了會紅 | C | P11-01～06 | 稽核報告列出已證明／未證明項目 | — | ⛔ |

### P12 部署

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P12-01 | 部署前重新盤點，與 `docs/private/server-inventory.md` 比對；`drn` 名稱零重名；port 3961 未占用 | C | — | 差異報告（預期：無 drn 資源） | — | ⬜ |
| P12-02 | `infra/docker-compose.prod.yml`：`drn-backend`（127.0.0.1:3961）、`drn-worker`、`drn-redis`（`redis:7-alpine`，不發佈 port），網路 `drn_net`，記憶體上限（backend 1.5G、worker 1G、redis 256M），log 輪替（max-size 10m×3） | C | P3 | `docker compose config` 無錯；本機以同檔啟動 healthy | `git revert` | ⬜ |
| P12-03 | 映像在 Mac（arm64，與主機同架構）建置 → `docker save \| gzip` → 傳主機 → `docker load`；主機上不 build | C | P12-02 | 主機 `docker images` 出現 `drn-backend:<tag>`；磁碟剩餘 ≥ 4 GB，否則停手 | `docker rmi drn-backend:<tag>` | ⬜ |
| P12-04 | 新增 `/etc/nginx/sites-available/drn.conf`（只含 `api.dr.nature.smilelife.tw`）→ symlink → `nginx -t` → `reload` | C | U-05 | `nginx -t` 成功；其他 65 個站台設定檔 md5 前後一致 | 刪 symlink＋`nginx -t`＋`reload` | ⬜ |
| P12-05 | 憑證：`certbot certonly --webroot -d api.dr.nature.smilelife.tw`（不讓 certbot 改其他站台） | C | P12-04 | `curl -I https://api.dr.nature.smilelife.tw/health` → 200 | `certbot delete --cert-name …` | ⬜ |
| P12-06 | 資料庫遷移與種子（對 Supabase `drn-prod`） | C | P0-08 | `medusa db:migrate` 成功；Store API 回商品 | Supabase 時間點還原 | ⬜ |
| P12-07 | Vercel 正式部署＋網域 `dr.nature.smilelife.tw` | C＋U | U-05、P0-09 | `curl -I https://dr.nature.smilelife.tw` → 200，憑證 CN 正確（不再是 jadedrop） | Vercel 回上一版／移除網域 | ⬜ |
| P12-08 | 備份：Supabase 每日備份確認；`drn-redis` 無需備份（僅 session） | C | P12-06 | Supabase 後台看到最近備份 | — | ⬜ |
| P12-09 | 部署後檢查：既有容器清單、nginx 站台、排程與部署前完全一致（除新增 drn 資源） | C | P12-07 | diff 腳本輸出僅 drn 相關新增 | 依各任務回滾 | ⬜ |
| P12-10 | 正式站 smoke（只讀）＋一筆真實訂單（Aki 付款後退款） | C＋U | P12-09、U-02 | P11-02 對正式站全綠；真實訂單走完並退款成功 | — | ⬜ |
| P12-11 | 回滾演練一次（Vercel 回上一版；後端換回上一個映像 tag） | C | P12-10 | 演練紀錄 | — | ⬜ |

### P13 上市營運

| ID | 任務 | 負責 | 前置 | 驗收 | 狀態 |
|---|---|---|---|---|---|
| P13-01 | 團購招商啟動（照 groupbuy-launch-runbook：五把鑰匙 → D0 品牌建檔 → D1 名單三閘門 → 招商信） | C＋U | P8-08 | Runbook 各步驟離開條件 | ⛔ |
| P13-02 | 電商平台上架評估（momo、蝦皮、酷澎等）與價格紀律 | C | P1-07 | 策略文件核准 | ⛔ |
| P13-03 | Dr.Grey 建品牌、跑首次稽核、排 pillar／cluster 內容計畫 | C＋U | P6-05 | 稽核分數與待辦清單 | ⛔ |
| P13-04 | DigiAds 建品牌、接 Pixel／CAPI、首波廣告 | C＋U | P8-05 | DigiAds 預檢通過 | ⛔ |

## 8. 關鍵路徑與並行

```
法規研究 P1-01 ─▶ 命名 G2/P2-01 ─▶ 標示 P2-04 ─▶ 包裝 D-07 ─▶ 印刷（前置期最長）
D-01/02/03 ─▶ tokens P1-08 ─▶ 前台 P7 ─┐
P3 後端 ─▶ P4 ECPay ─▶ P7-05 結帳 ─────┼─▶ P11 測試 ─▶ P12 部署 ─▶ G7 上線
P5 會員／P6 Blog／P8 整合／P9 分潤 ─────┘
```

可並行：DESIGN 做 D-01～D-07 時，CODE 同時做 P0、P1 文字、P3、P4、P5、P6 後端（不依賴視覺）。前台頁面等 D-05 到位後再接。

## 9. 本文件不能保證的事

- 任何 ECPay、LINE、Meta、簡訊商的**正式環境**行為，在 Aki 提供正式金鑰並手動驗一次之前，都只算「測試環境已驗證」。
- 法規判斷以官方公告文字為準；`regulatory.md` 是研究整理，不是法律意見，送審前建議由食品法規顧問複核。
- 印刷、瓶器、代工的交期由供應商決定，本計畫不估。
