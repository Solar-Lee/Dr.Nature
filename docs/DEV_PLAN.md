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
4. 主機上非 drn 的資源在部署前後完全一致：VPS 的 58 個容器與 65 個 nginx 站台（暫時頁，已驗證），以及 Mac mini 上非 drn 的容器、資料卷、網路、監聽埠、LaunchAgent（`infra/host/drn-inventory.sh compare` → unexpected=0）。

## 2. 已定案的決策（2026-10-13，Aki 核准）

| # | 決策 | 理由 |
|---|---|---|
| A1 | 電商核心：**Medusa v2**（npm 最新 2.21.2，查證於 2026-10-13）＋ **Next.js** 前台 | 購物車、促銷、客群、RBAC（2.15.5 起）、後台都是內建；自架、資料自有 |
| A2 | 金流／物流／發票：**綠界 ECPay**（先用官方測試環境，正式金鑰由 Aki 申請） | 一次整合信用卡、ATM、超商代碼、Apple Pay、超商取貨、電子發票 |
| A3 | ~~部署：**混合式**~~（2026-10-13 由 A7 取代，以下保留供參考）——前台 Vercel；Medusa server＋worker＋Redis 在 VPS（映像在 Mac 建好再傳）；Postgres＋檔案儲存在**新建的專屬 Supabase 專案** | VPS 磁碟 97%、CPU 近滿載；前台需要 CDN 承載影片與 3D |
| A4 | 設計交接走 GitHub repo：DESIGN 產出放 `design/` | 單一真實來源、可版控 |
| A5 | **不重造既有系統**：團購招商／寄樣／結算 → tuangou-admin（新增品牌 `drnature`）；全通路客服 → OmniCS（站內嵌 widget）；廣告 → DigiAds；站外 SEO → Dr.Grey | 這些系統已在正式環境運作（盤點見 §4） |
| A6 | 物流：**綠界 C2C 店到店**（7-ELEVEN／全家／萊爾富）；**全館免運**（運費 NT$0） | 起步免月租、門市覆蓋廣；免運降低結帳摩擦 |
| A7 | **2026-10-13 18:40 改定**：正式主機改為 **Mac mini M4**（實測 16 GB／460 GB，macOS 26.4；容器執行環境 **Docker Desktop 29.6.1**），取代 A3 的「VPS＋Supabase」；資料庫自架 `drn-postgres`；對外走 Cloudflare Tunnel（研究已查證，待 Aki 設定）；MVP 只上後端，前台維持暫時頁；Claude Code 在 Mac mini 接手。交接：[handoff/CODE_HANDOFF.md](handoff/CODE_HANDOFF.md)；runbook：[ops/deploy-backend.md](ops/deploy-backend.md)（決定 D1–D25 待 Aki 核准） | U-04 暫不升級；VPS 磁碟只剩約 5 GB 且與 57 個其他容器共用 |

## 3. 系統架構

```
瀏覽器
  │
  ├─▶ Vercel：apps/storefront（Next.js）  https://dr.nature.smilelife.tw
  │       │  伺服器端呼叫（publishable key）
  │       ▼
  ├─▶ Cloudflare Tunnel → Mac mini（Docker Desktop；A7）  https://<API_HOST>（D12 建議 drn-api.smilelife.tw）
  │       ├─ drn-cloudflared（只接 drn_edge）
  │       ├─ drn-backend  127.0.0.1:3961  Medusa server + Admin（/app）
  │       ├─ drn-worker   （不對外）       排程、訂閱者、通知
  │       ├─ drn-postgres （僅 drn_net）   資料卷 drn_pgdata；每晚 pg_dump，age 加密後上 R2
  │       └─ drn-redis    （僅 drn_net）   AOF
  │   （舊：VPS nginx＋Supabase，A3 已由 A7 取代）
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
infra/              docker-compose.prod.yml、drill 覆寫檔、backend.Dockerfile、host/（Mac mini 主機腳本與 LaunchAgent 範本）、nginx drn.conf（VPS 暫時頁）
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
| G1 | 部署架構 | Aki | ✅ 混合式（2026-10-13）→ A7 Mac mini＋Docker Desktop＋Cloudflare Tunnel（2026-10-13 18:40）；主機守則 CLAUDE.md §1b 與決定 D1–D25 待核准 |
| G2 | 產品名稱與功效用詞（日日順／晶亮／舒敏 是否保留；一般食品或申請健康食品） | Aki（CODE 依法規研究提案） | ⏳ 提案已出：[product/naming-proposal.md](product/naming-proposal.md) |
| G3 | LINE OA webhook 歸屬：① 招商期給 `drnature_bot`（團購既有模式，鏡射到 tuangou 即時收件匣）② 給 OmniCS（消費者客服）③ 寫轉發器同時送兩邊 | Aki | ✅ ① 給團購招商機器人 `drnature_bot`（2026-10-13）→ **2026-10-15 重裁為 ③**：Medusa 接 webhook（驗章、客服人設、會員綁定），驗章後把原始 body 與原 `x-line-signature` 轉發給 `drnature_bot`（LINE-07；轉發網址由 Aki 以 `LINE_OA_FORWARD_URL` 寫進主機 .env，tuangou 端換上新 secret）。切換 webhook URL（LINE-14）與邊緣放行（LINE-15）另行逐項核准 |
| G4 | 視覺方向三選一（D-01）、Monogram 三選一（D-02） | Aki | ⬜ |
| G5 | 品牌故事／Slogan 三選一（P1-03、P1-04） | Aki | ✅ 2026-10-15 主句採 slogan.md 推薦稿「少說一點，說準一點。／Say less. Say it exactly.」（取代預覽版沿用 DESIGN 原型的「以科學，讀懂自然」——該句違反 slogan.md 規則 4 且未經評審；CC-01 落實）。品牌故事仍用推薦稿 |
| G6 | 付費素材生成批次核准（每批列出張數與點數） | Aki | ⬜ |
| G7 | 正式上線（G-LAUNCH 清單全綠） | Aki | ⬜ |

## 5b. 付款流程決定（2026-10-13，P4-03）

採台灣常見的「先成立訂單、再付款」：購物車完成時建立「待付款」訂單（付款狀態未付），導向綠界付款；綠界伺服器通知（ReturnURL，簽章驗證）後才記錄為已付款。好處：庫存在付款前即保留、ATM／超商代碼（P4-04）用同一流程、顧客可從訂單頁重新付款。代價：需清理逾時未付訂單（P4-09），訂單成立通知與付款完成通知要分開（P8-02）。

## 6. USER（Aki）待辦——只有你能做的事

| 編號 | 事項 | 擋住 |
|---|---|---|
| U-01 | **輪替已外露的憑證**：LINE OA Channel secret／Access token（曾寫在 Pages 檔）；`3. Key/key.md` 內與本專案無關的金鑰另存他處 | 安全 ✅ 2026-10-15 Aki 回報：已輪替並寫進主機 .env（值未經對話；名稱 `LINE_OA_CHANNEL_ID`／`LINE_OA_CHANNEL_SECRET`，LINE-02 白名單合併後生效）。`3. Key/key.md` 搬移未回報 |
| U-02 | 申請綠界特店（金流＋物流＋電子發票），取得正式金鑰後親手寫入主機 `.env` | P4 正式切換 |
| U-03 | 選定簡訊商（建議三竹 Mitake 或 Every8d）並開通帳號 | P8 簡訊 |
| U-04 | Vercel：建立或指定團隊（商用需 Pro）；Supabase：核准建立新專案 `drn-prod`（Pro，避免閒置暫停）。**2026-10-13 查：Supabase 組織「Alex-Lee's Org」是 Free 方案，已有 2 個運作中的專案（kol-groupbuy-system、natrees-line-oa），再建一個會碰到免費方案的上限，且免費專案閒置會暫停 → 需要 Aki 把組織升級 Pro，或另開一個 Pro 組織給 drn-prod** | P0-08、P0-09、P12-06 **2026-10-13 Aki：暫不升級（見 A7）** |
| U-05 | DNS：`dr.nature.smilelife.tw` 改 CNAME 到 Vercel；新增 `api.dr.nature.smilelife.tw` A 記錄 → 151.145.69.134（DNS only，不走代理） | P12 **2026-10-13：api A 記錄已建立並生效。A7 後：刪除這筆 A 記錄，改為 `<API_HOST>`（D12 建議 `drn-api.smilelife.tw`）的 Tunnel CNAME（橘雲）；步驟見 [ops/deploy-backend.md](ops/deploy-backend.md) §2** ✅ 2026-10-14 舊 A 記錄已刪；`dr.nature.smilelife.tw` 依 Aki 決定維持指向 VPS 暫時頁（兩層子網域沒有 Free 憑證，不買 ACM） |
| U-06 | GS1 Taiwan 申請商品條碼（EAN-13），三個 SKU 各一 | P2 包裝定稿 |
| U-07 | 食品業者登錄字號（非登）、產品責任險、委託製造廠資料（廠名、地址、許可） | 標示定稿 |
| U-08 | 菌株資料：每款的菌種學名、菌株編號、每顆含菌數、原料供應商文件、檢驗報告 | 產品文案、標示 |
| U-09 | 交易信服務選定（訂單確認、出貨通知）。**也是會員 Email 驗證信的前提：選定前正式站只有 Google 能註冊新會員**（審查 auth-2，docs/ops/customer-login.md §2） | P8、P5-01 Email／LINE 註冊 |
| U-10 | 定義或核准會員等級門檻（CODE 會先提案） | P5 |
| U-11 | Meta Business：Pixel 與 CAPI token；GA4、GTM、Search Console 權限 | P8 |
| U-12 | 研發長肖像與名義使用的書面同意（官網、廣告、包裝） | P7 信任區塊 ✅ 2026-10-15 Aki 回報：已有書面同意，且涵蓋 LINE OA 客服人設、圖文選單、推播（CC-08／LN-02 解除；文件本身不入 repo，由 Aki 保存）。人設仍受 claims.md §4：不稱醫師、揭露利益關係、不背書功效 |
| U-13 | 綠界物流寄件人：**個人姓名**（2-5 個中文字；C2C 未取件退回寄件門市須出示身分證領取，綠界規定勿填公司名，developers.ecpay.com.tw/8809/）＋手機；並向綠界確認 C2C 合約是否含黑貓宅配 | P4-05 正式切換、宅配上架 |
| U-14 | 綠界**正式**發票後台：【發票通知方式設定】開啟開立、作廢、中獎通知（Email）給買受人（測試環境不寄，無法替你驗證）；確認是否開通超商 kiosk 列印中獎發票 | 發票上線（要點第二十四點中獎通知義務） |
| U-15 | 每瓶貨本（COGS）、首批產量、贈品成本（GTM 與會員制的毛利 50% 閘門、R5 都要用） | P1-07、P5-02、P5-07 定案 |
| U-16 | 綠界廠商後台：把正式主機對外 IP 加入 TradeNoAio（對帳檔下載）的 IP 白名單。**Mac mini 在家用網路，對外 IP 不固定；沙箱期不受影響，正式切換前另案處理** | P4-07 正式對帳 |
| U-17 | LINE Developers：Login channel 的 Callback URL、連結官方帳號（加好友提示）、（選擇性）申請 Email 權限；Google Cloud：OAuth 重新導向 URI。網址見 [ops/customer-login.md](ops/customer-login.md) §4 | P5-01 正式登入 |
| U-18 | 付款規則決定（詳見 [reviews/2026-10-13-p4-p5-review.md](reviews/2026-10-13-p4-p5-review.md)「要 Aki 決定」）：① ATM／超商代碼過期後要不要保留重新付款的時間（目前期限一到就自動取消）② 每張訂單最多 5 筆綠界交易 ③ Apple Pay 未付款改為 180 分鐘取消（原 24 小時）、信用卡仍預設 180 分鐘 ④ 信用卡被拒後 40 分鐘才能重新付款 | P4-09 定案 |
| U-19 | 問綠界：① 信用卡付款頁最長開多久 ② QueryTradeInfo 能否看出「已取號」 ③ TradeNoAio 對帳檔最大日期範圍 | P4-09 縮短等待、P4-07 多日對帳 |
| U-20 | ~~核准 Mac mini 守則與部署決定~~ ✅ 2026-10-14 Aki：「D1–D25 照建議，開始主機端步驟」 | P12 全部主機端步驟 |
| U-21 | Mac mini 設定：~~電源（不睡眠、斷電後自動開機）~~、~~關閉自動安裝 macOS 更新~~、~~Docker Desktop「登入時自動啟動」~~、網路線、路由器不轉發、UPS。2026-10-14 Aki 執行 `sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1 powernap 0`，`pmset -g custom` 查證 sleep 0／disksleep 0／autorestart 1／womp 1／powernap 0（此前 10-14 15:06–15:25 曾閒置睡眠，期間 API 斷線）。同日 Aki 關閉「自動更新」：`AutomaticallyInstallMacOSUpdates`=0、`AutomaticDownload`=0、`CriticalUpdateInstall`=0（安全性回應也不會自動裝，更新改由 Aki 手動、排維護時段）；Docker Desktop「Start Docker Desktop when you sign in」已勾（Aki 截圖）。待裝：macOS Tahoe 26.7.1 等更新（建議與 P12-19 整機重開演練一起做）；macOS 27 大版本升級先不做。網路線、路由器、UPS 未確認 | P12-06、P12-19 |
| U-22 | ~~在主機執行 `drn-gen-env.sh <API_HOST>` 產生正式 `.env`~~ ✅ 2026-10-14（env-check missing=0 forbidden=0） | P12-06 |
| U-23 | Cloudflare：帳號 2FA、~~刪舊 A 記錄~~、~~**Access 兩個應用**~~、~~WAF skip 規則~~、~~Tunnel 通知~~（2026-10-14 Aki 在對話逐項核准，CODE 在後台建立，ingress 已改 public）；Healthchecks 5 個檢查、UptimeRobot、age 金鑰、R2 bucket 與 rclone；步驟見 [ops/deploy-backend.md](ops/deploy-backend.md) §2。~~Tunnel 與 token~~ ✅ 2026-10-14 Aki 在瀏覽器 Authorize，tunnel 與 route 由 CODE 建立 | P12-04、P12-08、P12-20 |

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
| P0-10 | GitHub Actions CI：install → lint → typecheck → `scripts/test-all.sh` → build | C | P0-07 | 開一個故意壞掉的 PR → CI 紅；修好 → 綠 | 刪 workflow | 🟡 workflow 已提交（f488cf4；Postgres 16 service、actions 釘選 2 週以上的 release SHA）；同一流程在本機 `scripts/test-all.sh` 全綠。**驗收要 Aki**：push 後開一個故意壞掉的 PR → CI 紅，修好 → 綠 |

### P1 品牌策略與文字（C）／視覺識別（D）

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P1-01 | 法規研究：一般食品允許例句、禁用詞、健康食品路徑、標示、代言規範 → `docs/research/regulatory.md`（每條附官方來源） | C | — | 每條規則都有來源網址；無來源者標「未驗證」 | 刪檔 | ✅ |
| P1-02 | 合規用詞表 `docs/compliance/claims.md` ＋ 自動掃描腳本 `scripts/claims-lint.mjs`（掃 `content/` 與前台字串） | C | P1-01 | 放一句「改善便秘」到測試檔 → 腳本離場碼 ≠ 0 | `git revert` | ✅ |
| P1-03 | 品牌故事／精神／語調 3 版 → 迭代 → 推薦 1 版 `content/brand/story.md` | C | P1-02 | 三版並列＋評分表；全文過 claims-lint | `git revert` | ✅ 三版並列＋三位評審（A 45.83／C 44.17／B 36.33）＋推薦版，claims-lint 0（45a6953）。**G5 待 Aki 選定**；提到研發長的句子標〔需 U-12 同意〕 |
| P1-04 | Slogan 3 版 → 推薦 1 版 `content/brand/slogan.md` | C | P1-02 | 同上；中英各一 | `git revert` | ✅ 三版＋推薦「少說一點，說準一點。／Say less. Say it exactly.」（e205ee1）。G5 待 Aki 選定 |
| P1-05 | 研發長查證頁 `docs/research/cro.md`：只收錄來源網頁實際寫到的經歷 | C | — | 每一句有來源；論文、專利未查證者標「未驗證」 | 刪檔 | ✅ |
| P1-06 | 市場與競品研究 `docs/research/market.md` | C | — | 價格、通路數字都有來源 | 刪檔 | ✅ |
| P1-07 | 通路與行銷策略 `docs/strategy/go-to-market.md`（官網、團購、平台、LINE、廣告；價格帶與團購價政策；90 天節奏） | C | P1-06、G2 | 每個數字可追溯到 market.md；策略項目標明「分析」而非事實 | `git revert` | 🟡 提案已出（75ba40e）：三份草案、三位評審，混合節奏 C 勝出；每個數字可追溯到 market.md，策略標「分析」。**待 Aki 核准**（另需 G2、U-15 貨本） |
| D-01～D-03 | 視覺方向、Monogram、Design tokens | D | — | 見 DESIGN_BRIEF §5 | — | ⬜ |
| P1-08 | 驗收 D-03：tokens.json → `packages/tokens` 產生 CSS 變數與 Tailwind 主題（Style Dictionary） | C | D-03 | `pnpm --filter tokens build` 零錯誤；對比檢查腳本全部 AA | `git revert` | ⛔ |

### P2 產品、規格、包裝

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P2-01 | 產品命名定案（三款）＋系列名 → `content/products/index.md` | C | G2 | 名稱過 claims-lint；Aki 核准 | `git revert` | ⛔ |
| P2-02 | 編碼邏輯 `docs/product/sku-coding.md`：SKU（例：`DN-PB-01-060C`＝品牌-系列-品項-規格）、批號（例：生產日 `YYMMDD`＋產線碼）、條碼（GS1） | C | — | 規則可由腳本驗證（regex 測試通過） | `git revert` | ✅ |
| P2-03 | 規格指南 `docs/product/guidebook.md`：每款的菌種／菌株（待 U-08）、每顆含量、建議食用量、保存、效期、過敏原、素食標示、包裝規格（60 顆／瓶、100ml PE/PP 瓶、50×50×100 外盒） | C | U-08 | 未取得的欄位標 `待 U-08`，不得填推測值 | `git revert` | ⛔ |
| P2-04 | 法定標示文字 `content/products/<sku>/label.md`（品名、內容物、淨重、廠商、原產地、有效日期、營養標示、過敏原、注意事項…） | C | P2-01、P2-03、U-07 | 對照 regulatory.md 標示清單逐項打勾 | `git revert` | ⛔ |
| P2-05 | 產品頁文案 `content/products/<sku>/copy.md`（名稱、副標、介紹、使用方式、FAQ） | C | P2-01、P1-02 | claims-lint 綠 | `git revert` | ⛔ |
| D-07 | 貼標、外盒、品牌小卡設計 | D | D-02、P2-04 | DESIGN_BRIEF §5 第 5 條 | — | ⛔ |
| P2-06 | 印刷前核對：條碼可掃、標示完整、尺寸對刀模 | C＋U | D-07、U-06 | 逐項清單全部打勾、Aki 簽核 | 退回 D | ⛔ |

### P3 後端：Medusa 核心

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P3-01 | 建 `apps/backend`（`create-medusa-app` 對應 2.21.x；版本查證寫進提交訊息） | C | P0-06 | 本機 `docker compose up` 後 `curl :9000/health` → `OK` | `git revert` | ✅ |
| P3-02 | 本機開發用 `infra/docker-compose.dev.yml`（postgres:16-alpine、redis:7-alpine） | C | P3-01 | `docker compose ps` 三個服務 healthy | `docker compose down -v`（僅本機） | ✅ |
| P3-03 | 區域與幣別：Taiwan region、TWD、含稅價（5% 營業稅內含） | C | P3-01 | 整合測試：建立購物車 → 金額為含稅整數 TWD | `git revert` | ✅ |
| P3-04 | 商品資料種子 `apps/backend/src/scripts/seed.ts`：3 SKU、價格 1,150、庫存、圖片佔位 | C | P3-03、P2-02 | `medusa exec seed` 後 Store API 列出 3 件商品 | 重建資料庫 | ✅ |
| P3-05 | 銷售通路：官網、團購（分潤賣場）兩個 sales channel＋各自 publishable key | C | P3-04 | Store API 以不同 key 查詢，商品集合符合設定 | `git revert` | ✅ |
| P3-06 | 檔案儲存改 S3 provider（Supabase Storage） | C | P0-08 | 後台上傳圖片 → 公開 URL 回 200 | 改回 local provider | ⏸ A7 改用 file-local＋資料卷 `drn_uploads`（P12-15）；前台上線前再評估 R2／S3 |
| P3-07 | 後台 RBAC：角色「管理員／營運／客服／內容編輯／財務」與權限（`rbacRole`、`rbacPolicy`，2.15.5 起） | C | P3-01 | 整合測試：內容編輯角色呼叫商品刪除 API → 403 | `git revert` | ✅（另補 Medusa 2.21.2 RBAC 缺口，見 docs/reviews/2026-10-13-p3-backend.md；**待 Aki 確認：營運角色可取消訂單＝自動退款**） |

### P4 ECPay 金流／物流／發票

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P4-01 | 查證 ECPay 目前版 API 文件（AIO 金流、物流、B2C 電子發票）→ `docs/research/ecpay.md`（端點、CheckMacValue 演算法、測試帳號取得方式、回傳格式） | C | — | 每個端點附官方文件網址 | 刪檔 | ✅ |
| P4-02 | CheckMacValue 純函式＋單元測試（用官方文件範例向量） | C | P4-01 | 官方範例輸入 → 官方範例輸出，完全相同 | `git revert` | ✅ |
| P4-03 | Payment provider `ecpay`：建立付款（導轉表單）、`getWebhookActionAndData`（驗章失敗一律 failed）、退款 | C | P4-02 | 測試環境：信用卡測試卡付款 → 訂單狀態 captured；竄改 CheckMacValue 的回呼 → 拒絕且不改訂單 | 停用 provider | ✅ 本機驗證＋審查修正（簽章通知即付款證明、零 QueryTradeInfo 熱路徑；16 支整合＋90 支單元，含反向測試）；**實際 ECPay 測試環境回呼待 P4-04 公開網址**；退款暫以 manual_pending＋SOP（docs/ops/ecpay-manual-refund.md）直到 P4-08 |
| P4-04 | 付款方式：信用卡、ATM、超商代碼、Apple Pay（依 ECPay 測試環境實際支援為準） | C | P4-03 | 每種方式在測試環境走完一次，截圖存 `e2e/evidence/` | 停用該方式 | 🟡 程式完成（ATM／超商代碼／條碼＋PaymentInfoURL，22 支整合＋121 支單元，含反向測試）；**真實綠界測試環境已接受四種簽章表單、QueryTradeInfo 格式與簽章已驗證**（docs/research/ecpay-stage-probe-2026-10-13.md）；剩餘：公開網址後的完整回呼與付款截圖（stage 需開 `ECPAY_ACCEPT_SIMULATED_PAYMENTS`） |
| P4-05 | Fulfillment provider `ecpay-logistics`：7-11／全家／萊爾富超商取貨（電子地圖選店）、宅配 | C | P4-01 | 測試環境：選店 → 建物流單 → 取得托運單號 | 停用 provider | 🟡 程式完成＋審查修正（docs/reviews/2026-10-13-p4-05-ecpay-logistics.md；23 支整合＋75 支單元，10 個反向測試皆轉紅）；**真實綠界測試環境：三家 C2C 建單成功且回應簽章驗證通過；經我方 provider＋Medusa 出貨流程取得托運單號 D8844528-4456**（docs/research/ecpay-logistics-stage-probe-2026-10-13.md；QueryLogisticsTradeInfo 亦已實測）；剩餘：公開網址後的狀態通知與選店回傳（stage 不推送狀態）、正式寄件人（U-13）；宅配選項已建立但未上架 |
| P4-06 | 電子發票：付款成功後開立（載具：手機條碼／自然人憑證／會員；捐贈碼；統編） | C | P4-03 | 測試環境開立 → 回傳發票號碼寫入訂單 metadata；作廢流程測一次 | 停用訂閱者 | 🟡 程式完成＋審查修正（docs/reviews/2026-10-13-p4-06-ecpay-invoice.md；27 支整合＋55 支單元，反向測試 23 個皆轉紅）；**真實綠界 stage：經我方訂閱者開立 LO22068054 並以我方作廢流程作廢，GetIssue 確認**（docs/research/ecpay-invoice-p4-06.md）；作廢需買受人同意（要點第九點）、有效訂單只能作廢＋重開；剩餘：正式商店與通知設定（U-02、U-14）、前台發票選項與告知事項（P7-05） |
| P4-07 | 冪等與對帳：同一回呼重送兩次只入帳一次；每日對帳腳本 | C | P4-03 | 測試：同一 payload 重送 → 第二次 no-op | `git revert` | ✅ 重送冪等（同一通知只入帳一次）＋每日對帳 TradeNoAio（cd4b44e）：只算 DN 開頭的交易；漏登 → 嚴格查詢後補登；金額不符、找不到 session、已收款卻不在清單 → 告警（7 支整合＋5 支單元，反向測試 D1–D5 皆轉紅）。**正式環境需 U-16**。 審查修正：[reviews/2026-10-13-p4-p5-review.md](reviews/2026-10-13-p4-p5-review.md) 付款鎖修正後：只有真的入帳才算補登，其他結果告警；依已入帳款項的 session id 查（cb557be）。 |
| P4-08 | 信用卡退款自動化：CreditDetail/DoAction（**僅正式環境有此 API，測試環境無法驗證**）＋先查卡片明細決定 R／N／E；完成前退款一律在綠界廠商後台手動處理 | C＋U | P4-03、U-02 | 以第一筆真實小額交易做一次退款並對帳；之前 `refundPayment` 一律拒絕並提示後台退款（已有測試） | 改回拒絕 | 🟡 程式完成、預設關閉（`ECPAY_AUTO_REFUND`，6831739）：先查卡片明細決定 N／C+R／E+N／R，判斷不了就轉人工；25 支單元，反向測試 R1–R5 皆轉紅。**這個 API 只有正式環境有**：第一筆真實小額交易退款驗證後才開（U-02） |
| P4-09 | 未付款訂單：信用卡 N 分鐘未付自動取消並釋放庫存；訂單頁「重新付款」產生新 MerchantTradeNo（舊編號不可重用） | C | P4-03 | 整合測試：逾時訂單被取消、庫存回補；重新付款可成功 | 停用排程 | ✅ 取消前先嚴格查詢綠界（已付 → 補登；查不到 → 保留）；ATM／超商代碼依繳費期限加寬限；重新付款（擁有者檢查、鎖、代碼仍有效時 409）（088bd5c；9 支整合，反向測試 U1–U6 皆轉紅）。**信用卡逾時預設 180 分鐘（`ECPAY_UNPAID_CANCEL_MINUTES`），待 Aki 決定**；自動取消不回補促銷使用次數（Medusa 2.21.2 限制，SOP 已註明）。 審查修正：[reviews/2026-10-13-p4-p5-review.md](reviews/2026-10-13-p4-p5-review.md) **付款鎖修正（0982d6e、d6c7833）**：每個付款集合一把鎖；取消期限從目前交易起算；舊交易可能還會付款時不開新交易（409＋`retry_after`）；舊交易保留，事後付款標 `ecpay_paid_twice` 告警；最多 5 筆交易；關閉 Medusa 內建 webhook（編碼繞過已修，6392309）；管理員取消與入帳同時發生 → 告警（3108aee、b522a15，`ecpay-cancel-race.spec.ts`）。**待 U-18、U-19**。 |
| P4-10 | 對帳排程：定期以 QueryTradeInfo 查詢待付款訂單（遵守頻率限制，過快會被擋 30 分鐘），補抓漏掉的 ReturnURL | C | P4-03 | 替身測試：回呼遺失 → 排程補登為已付款 | 停用排程 | ✅ 信用卡付款在 40／120／1440 分鐘補查 QueryTradeInfo；403 時全域暫停 30 分鐘；離線付款不輪詢（a20bf60；8 支整合）。 審查修正：[reviews/2026-10-13-p4-p5-review.md](reviews/2026-10-13-p4-p5-review.md) Apple Pay 與信用卡同樣補查（a782224）。 |
| P4-11 | C2C 出貨後續：門市關轉時讓顧客重選門市（UpdateStoreInfo）、7-ELEVEN C2C 取消（CancelC2COrder）、後台列印託運單、寄件期限 SOP（7-11 5 日／全家 6 日／萊爾富 7 日） | C＋U | P4-05、P7-05 | 替身測試：關轉通知 → 顧客重選 → 呼叫 UpdateStoreInfo；7-11 取消出貨 → 呼叫 CancelC2COrder | 停用功能（回到告警＋後台處理） | ✅ 顧客重選門市（UpdateStoreInfo 01）、我方退件門市（02，營運權限）、7-11 取消（CancelC2COrder）、後台列印託運單、SOP [ops/ecpay-logistics-c2c.md](ops/ecpay-logistics-c2c.md)（a718011、0205cd1、721367f）。**真實綠界 stage：UpdateStoreInfo 簽章與回覆格式、CancelC2COrder「1\|OK」已驗證**；反向測試整合 9／10 轉紅（1 個為等價變異）、單元 4／4。剩餘：公開網址後實測關轉通知。 審查修正：[reviews/2026-10-13-p4-p5-review.md](reviews/2026-10-13-p4-p5-review.md) |

### P5 會員、等級、促銷

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P5-01 | 會員登入：Email＋密碼、Google、LINE Login | C | P3-01 | e2e：三種方式各登入成功 | 停用 provider | ✅ Email＋密碼、Google（Medusa 內建）、LINE Login（自訂 provider）（835e040）：LINE 以替身走完登入、建立會員、再次登入；state 重用／未知／缺少、nonce 不符、其他 channel、其他發行者、錯誤 code、取消同意皆 401；Google 驗到導轉與偽造 state（整合 5、單元 5，反向測試 A1–A8 皆轉紅）。SOP [ops/customer-login.md](ops/customer-login.md)。**真實同意畫面與 Google token 交換：U-17 之後在 P11 e2e 驗**。 審查修正：[reviews/2026-10-13-p4-p5-review.md](reviews/2026-10-13-p4-p5-review.md) |
| P5-02 | 會員等級提案 `docs/strategy/membership.md`（門檻、權益、降級規則） | C | P1-07 | Aki 核准（U-10） | — | 🟡 提案已出（3721b2c）：三個等級（會員／回購會員 ≥1,035／長期會員 ≥9,315，近 12 個月已確認淨消費）、確認期、升降級時點、疊加規則 R1–R5、成本模型、個資；CFO＋合規審查 17 項已修。**待 Aki 核准（U-10）** |
| P5-03 | 等級引擎：每日排程＋退款／取消訂閱者 → 重算近 12 個月已確認淨消費 → 移動客群（customer group） | C | P5-02 | 整合測試：收貨 9 天不升級、11 天升級；退款跌破 → 立即降級；滾出視窗 → 每月 1 日才降級；同時在兩個客群 → 修正為一個；訪客不評估 | 停用訂閱者 | ✅ 等級引擎（7314e87）：每日 03:00 排程＋退款／取消訂閱者；收貨滿 10 天才計入、無物流紀錄則付款後 30 天；到期降級只在每月 1 日；一位會員只在一個等級客群；設定與 membership.md 不一致或不合法 → 拒絕執行；**提案狀態的設定不會在正式環境執行**（整合 6、單元 15）。 審查修正：[reviews/2026-10-13-p4-p5-review.md](reviews/2026-10-13-p4-p5-review.md) |
| P5-04 | 等級專屬促銷：以 `customer.groups.id`（運算子 `in`）規則建立會員價；團主碼／首購禮／會員價三擇一 | C | P5-03 | 整合測試：非該等級的購物車套用 → 不折抵 | 停用促銷 | ✅ 會員價範本 `member_price`（a7346b1）：規則 `customer.groups.id`＋`in`（原文 `customer.group.id` 有誤，已更正）；**用代碼而非自動套用**，讓會員能改選團主優惠（R2）；折扣不得超過等級設定；R2 三擇一在結帳時擋（整合：訪客、非等級會員、1 瓶皆不折；2／3／4 瓶每瓶 1,035；會員價＋團主碼被拒）。 審查修正：[reviews/2026-10-13-p4-p5-review.md](reviews/2026-10-13-p4-p5-review.md) |
| P5-05 | 活動促銷範本：滿額折、第二件折、買 X 送 Y、免運、限時、預算上限的 campaign | C | P3-04 | 每種範本一支整合測試 | 停用促銷 | ✅ 範本：滿額折、第二件折、買 X 送 Y、免運，可加限時窗口與預算上限（f1b7828）；建立時檢查贈品上限（事業提供贈品贈獎額度辦法 §4，[查證](research/gift-rules-2026-10-13.md)）與商品存在；結帳時 R1 每瓶 ≥1,035（`-X{n}` 組合依瓶數）、R3 含贈品每瓶等值 ≥862.5、R4 每單最多一份贈品（1f1e145）；SOP [ops/promotions.md](ops/promotions.md)。數字為提案，隨 P5-02 核准。 審查修正：[reviews/2026-10-13-p4-p5-review.md](reviews/2026-10-13-p4-p5-review.md) |
| P5-06 | 會員權益其餘部分：生日禮客群（每日同步、每個生日週期一次）、人工調整等級與異動紀錄（操作者、理由、保存期限）、退款原因分類（退貨／善意折讓） | C | P5-02 核准、P5-01（生日月份欄位） | 整合測試：月中升級的壽星當天可領、退款降級後立即失去資格；客服角色不能調整等級 | 停用功能 | ⛔ |
| P5-07 | 3 入組／6 入組 variant（`-X3`／`-X6`）與會員價（客群 price list，不以「原價減折扣」呈現）；R5 毛利閘門（需貨本）；TRY 體驗包若用 `DN-PB-..-TRY` SKU，結帳規則要讓它不算瓶數（審查 promotions-3） | C | P5-02 核准、U-15 | 整合測試：會員 2 組 X3 → 6,210；非會員看不到 X6 價；把 R5 關掉 → 反向測試轉紅 | 停用 variant | ⛔ |

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
| P7-05 | 購物車＋結帳三步驟（資料、配送／選店、付款）＋訂單完成頁；發票選項（會員載具／手機條碼／自然人憑證／捐贈碼／統編）寫入 `cart.metadata.ecpay_invoice_choice`，並顯示電子發票實施作業要點第十九點應告知事項（docs/research/ecpay-invoice-p4-06.md） | C | P4-03、P4-05 | e2e（測試環境）：下單到完成頁 | `git revert` | ⛔ |
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
| P11-01 | 單元＋整合測試入 `scripts/test-all.sh`（後端用全新資料庫跑全部遷移） | C | P0-07 | 反向測試：弄壞一個遷移 → 紅 | — | ✅ 後端整合＋單元全入 test-all；2026-10-14 反向測試：在 drn-0001 遷移腳本開頭插入 throw → `bash scripts/test-all.sh` EXIT=1（backend:integration:http 失敗），drn-setup.spec 20/20 失敗且錯誤訊息出現 40 次「drn P11-01 broken migration」；還原後工作樹乾淨 |
| P11-02 | e2e smoke（Playwright）：首頁、商品頁、加入購物車、結帳到付款頁、Blog、登入；只讀模式可對正式站跑 | C | P7-05 | 本機與 staging 全綠；`E2E_ALLOW_WRITES` 未設時不建立訂單（測試斷言） | — | ⬜ |
| P11-03 | e2e 全流程（測試環境）：三種付款、兩種物流、發票、退款、等級升級、分潤歸因 | C | P4、P5、P9 | 全綠＋證據截圖 | — | ⛔ |
| P11-04 | 效能預算：行動版 LCP ≤ 2.5 s、CLS ≤ 0.1、INP ≤ 200 ms；首屏 JS ≤ 200 KB gzip | C | P7 | Lighthouse CI 斷言 | — | ⛔ |
| P11-05 | 無障礙：axe 零 serious／critical | C | P7 | Playwright＋axe | — | ⛔ |
| P11-06 | 資安：HawkScan DAST、相依套件稽核、webhook 驗章測試、速率限制 | C | P4、P8 | 零 High；webhook 竄改測試全部被拒 | — | ⛔ |
| P11-07 | 假綠稽核（false-green-audit 流程）：確認每道閘門壞了會紅 | C | P11-01～06 | 稽核報告列出已證明／未證明項目 | — | ⛔ |

### P12 部署（Mac mini＋Docker Desktop，2026-10-14 改寫）

> 計畫來源：2026-10-13 的部署 workflow（研究→三份方案→評審→批評迴圈），依 Aki 已安裝的 Docker Desktop 改寫；決定 D1–D25 與 Aki／CODE 的步驟在 [ops/deploy-backend.md](ops/deploy-backend.md)。**repo 端全部完成；主機端等 U-20～U-23**。2026-10-14 的本機演練用改名的 `drn-rh-*` 堆疊（不碰正式名稱）。每個 `✅` 都在該列註明驗收證據；主機端未做的部分標 ⛔ 並寫明等誰。

| ID | 任務 | 負責 | 前置 | 驗收 | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| P12-00 | Mac mini 主機守則 CLAUDE.md §1b（D1）；A7／CODE_HANDOFF 事實改成 16 GB／460 GB／Docker Desktop；runbook 與 ops 文件 | C 起草、U 核准 | — | `grep -c '^## 1b' CLAUDE.md` → 1；舊的記憶體與磁碟規格數字（24／512）在 DEV_PLAN 與 CODE_HANDOFF 都已改掉；claims-lint 0 | git revert | ✅ Aki 2026-10-14 核准：「D1–D25 照建議，開始主機端步驟」（U-20） |
| P12-01 | 部署前盤點：`infra/host/drn-inventory.sh snapshot／compare`（正規化、規則比對） | C | P12-00 | `node --test scripts/__tests__/inventory.test.mjs` → 0；主機：`snapshot ~/drn/logs/inventory-pre.txt` 7 段、3961 無人監聽、disk ≥ 40 | git revert | ✅ 腳本與 6 支測試（750393b；4 個反向測試轉紅）；主機快照 2026-10-14 已存 `~/drn/logs/inventory-pre.txt`（7 段、3961 無人監聽、disk 187 GB） |
| P12-13 | 容器執行環境：Docker Desktop（取代 Colima）；`drn-docker` 包裝固定 socket、自有 `DOCKER_CONFIG`、`unset DOCKER_CONTEXT`；Aki 設登入自動啟動 | C＋U | P12-01 | 包裝在假 HOME 無 socket → exit 2；`drn-docker compose version` 可用；pinned 映像匿名拉取成功 | 刪 ~/drn/bin | ✅ 包裝（0e5bb48）；2026-10-14 實測 compose v5.1.4、postgres／redis／cloudflared digest 拉取成功；**AutoStart 目前 False，等 U-21** |
| P12-28 | 容器到主機的探測 `drn-probe.sh`／`.mjs`（Docker Desktop 無 VM 防火牆，只量測，處置是 D24） | C | P12-13 | probe 測試 → 0；`--control` exit 1 且含 :9999；`--dns` dns-ok；無 drn_probe_tmp 殘留 | git revert | ✅（abd0951）；2026-10-14 正式網路 drn_net：`--control` exit 1 且含 :9999、`--dns` dns-ok、基準 open=23 寫入 `~/drn/state/probe-baseline`，清單只留 `~/drn/logs/probe-*.json`；D24 依 Aki 核准採建議 A（沙箱期接受，G-PII 前做 B 或 C） |
| P12-14 | DB TLS 規則：只放行精確主機名 `drn-postgres`，拒絕 `?host=`／`?hostaddr=` | C | — | jest src/lib/database 4 passed；4 個變異 RED；載入期 throw ≠0；test-all 0 | git revert | ✅（d153cc0；test-all 0） |
| P12-15 | 上傳檔：file-local、`<MEDUSA_BACKEND_URL>/static`，production 缺網址拒啟；映像預建 static | C | — | jest src/lib/file 4 passed；3 個變異 RED；映像內 static 擁有者 node | git revert | ✅（06281ff；映像檢查見 P12-03） |
| P12-16 | ENV 白名單補列（POSTGRES_*、TUNNEL_TOKEN、telemetry、NODE_ENV、DOCKER_*、DRN_*）；check-env-names 掃 infra/host 與 compose | C | — | `node --test check-env-names` → 0；`node scripts/check-env-names.mjs` 0 error(s) | git revert | ✅（5e0d63c、f08b6d6；32 檔 82 名稱 0 error） |
| P12-24 | production 缺 REDIS_URL 拒絕啟動（D22） | C | — | jest src/lib/runtime 3 passed；2 個變異 RED | git revert | ✅（7ee2b5f） |
| P12-20a | 排程 `drn-job-heartbeat`（每 10 分鐘 `[JOB-HEARTBEAT]`，D23） | C | — | jest src/lib/ops 2 passed；3 個變異 RED；映像 worker 真的寫出該行 | git revert | ✅（a07f872）；演練 worker 啟動 43 秒後寫出 |
| P12-10a | 公開網址演練守門與腳本 `ecpay-public-drill`（credit、atm、ship、status、logistics-notify、alert-selftest） | C | — | 守門 5 passed；4 個變異 RED；tsc 0；映像內有 .js | git revert | ✅（d88e606）；腳本本身只能在公開網址後執行（P12-10） |
| P12-02 | compose Mac mini 版：drn-postgres／drn-redis（AOF）／drn_uploads／drn-cloudflared（profile edge）、digest 釘選、drill override | C | P12-16 | compose-prod 10 項文字測試；`config -q` 假值 0；卷名 drn_pgdata drn_redisdata drn_uploads | git revert | ✅（f08b6d6；4 個反向測試轉紅） |
| P12-17 | `drn-gen-env.sh`／`drn-env-check.sh`（Aki 執行；不印值；`?sslmode=disable`） | C＋U | P12-16 | `node --test drn-gen-env` → 0；6 個反向測試 RED（1 個等價）；Aki 執行 → `missing=0 forbidden=0` | git revert；首次啟動前可 rm .env | ✅ 腳本（e5f0c38、525af09）；**U-22 ⛔** |
| P12-18 | 主機套件 `infra/host/`（install.sh、agents.sh、drn-docker、drn-compose、drn-maint、drn-lock、drn-compose-up、drn-alertscan、drn-check-migrations、drn-drill、drn-releases、LaunchAgent 範本） | C | P12-02 | host-files 16 測試 → 0；8 個反向測試 RED；主機：`install.sh` 後 ~/drn 700、無 .env、agents 0 | git revert；rm plist | ✅ 套件（0e5bb48）；2026-10-14 主機安裝：23 支腳本、~/drn 與 bin 700、無 quarantine、無 .env、tunnel.env／host.env 600、agents 0、4 個 plist lint OK、`drn-docker info` 與 `compose version` 正常 |
| P12-03 | `drn-build.sh` 建 `drn-backend:<sha12>`（不打 current）＋六項檢查；`check-image-deps.mjs` | C | P12-14～P12-18 | arm64、medusa 2.21.2、1002 packages 0 not in lockfile、admin clean、static 擁有者 node、drill 與 heartbeat .js 在映像內、`image-ok-<sha>` | `drn-docker rmi` | ✅（16f67fa；演練 HOME 建置 `drn-backend:16f67fa49828` 55.7 秒全部檢查通過）；正式 HOME 2026-10-14 建置 `drn-backend:c9bebe9905e2`（快取，2.7 秒），六項檢查通過，`image-ok-c9bebe9905e2` 存在，current 未建立 |
| P12-06 | 首次啟動：retag current、`releases first`、起 postgres／redis、兩步遷移、`drn-check-migrations`、起 backend／worker、煙霧測試 | C＋U | P12-03、U-22 | 兩步遷移 0／0；unfinished=0 drn=7/7；4 容器 healthy；無 port 發佈；/health OK；區網 curl exit 7；worker UTC；appendonly yes；static 可寫；/store/products 3 | `drn-compose down`（不加 -v） | ✅ 2026-10-14 正式啟動：Aki 以 drn-gen-env.sh 產生 .env（env-check missing=0 forbidden=0，U-22 完成）；current=c9bebe9905e2、ledger first；兩步遷移 0／0；unfinished=0 drn=7/7；4 容器 healthy；只有 127.0.0.1:3961 發佈；/health OK；區網 curl exit 7；worker UTC；appendonly yes；static 可寫；/store/products 3；三條回呼 400、內建 webhook 404；verify-current 0；記憶體 backend 236 MiB／worker 141／postgres 65／redis 12 |
| P12-05 | API 主機名稱（D12）：刪舊 A 記錄；確認邊緣憑證 | U | D12 | `dig +short api.dr.nature.smilelife.tw` 無輸出 | 加回 A 記錄 | ✅ 2026-10-14：`drn-api.smilelife.tw` CNAME（橘雲）解析；邊緣憑證 SAN `smilelife.tw, *.smilelife.tw`；舊 A 記錄 `api.dr.nature.smilelife.tw`（151.145.69.134，DNS only）經 Aki 核准刪除，`dig +short api.dr.nature.smilelife.tw @elaine.ns.cloudflare.com` 無輸出 |
| P12-04 | 對外連線：探測基準 → Access → Tunnel → route → WAF → 通知 → 啟用 edge → 外部驗收 → access-baseline | U＋C | P12-06、P12-05 | [ops/edge-cloudflare.md](ops/edge-cloudflare.md) 的驗收清單 | `rm edge-enabled`、停 cloudflared | ✅ 2026-10-14：Aki 在對話逐項核准後，CODE 在 Cloudflare 後台建 Access `drn-api-admin`（Allow，只放 Aki 的信箱，One-time PIN）與 `drn-api-public`（Bypass：`/hooks/ecpay/*`、`/health`）、WAF `drn-ecpay-callback-skip`（第 1 條）、Tunnel 通知兩條；ingress 改 `public`（4 條連線 quic）。外部驗收：SAN `*.smilelife.tw`；`/health` 200 OK；三條回呼 POST 400 `0\|CheckMacValue Error`（含空 UA、4 KB 本文，BIC 未擋）；`/app`、`/admin/users/me`、`/store/products`、`/static/x`、`/auth/user/emailpass` 都 302 到 `daisysos.cloudflareaccess.com`；client_ip 等於 trace ip；cloudflared 只在 drn_edge；區網連 3961 被拒、`*.cfargotunnel.com` 直連不通；access-baseline `status=302 location=daisysos.cloudflareaccess.com mitigated=0`。對抗式驗證（4 個探測、3 個反駁者）發現 Access Bypass 是前綴比對：`/health/x`、`/HEALTH`、`/hooks/ecpay/..%2f..%2fadmin/users/me` 會到後端（後端回 404，沒有資料外洩）→ public ingress 改成只放行三條回呼與 `/health` 的精確路徑，其餘同前綴在 tunnel 回 404（`cloudflared tunnel ingress rule` 逐條驗證；tunnel-setup 測試 3 → 0，舊腳本 → 1，載入期崩潰 → 1）；重驗 14 種變形全部 404 且未到 Express |
| P12-22 | 第一位管理員（`medusa user --invite`，Aki 設密碼）；驗 Secure cookie | U | P12-04 | 重新整理後仍登入；cookie Secure/HttpOnly/SameSite=Lax | Admin 刪使用者 | ⛔ |
| P12-08 | 每晚 04:15 備份（dump、globals、上傳檔、manifest、保留、age＋R2） | C＋U | P12-06 | backup 測試 9 → 0；真實演練 toc=1075；主機：kick 後 last exit 0、4 種檔案 | `agents.sh disable drn.backup` | ✅ 2026-10-14 正式啟用：`agents.sh enable drn.backup`，kick 後 last exit 0，daily 4 種檔案，toc=1075，`backup-enabled` 已建；反向演練：`--pg-container drn-postgres-nope` → exit 1、`fail line=67`、tmp 無殘留；`--retention-test` 20 組 → 14。**R2／age 異地等 U-23（offsite=unset）；Healthchecks 通知等 U-23** |
| P12-21 | 每週還原演練 `drn-restore-check.sh`（週日 05:00，同 digest、--network none、錨點） | C | P12-08 | 真實演練 pass（product=3 tables=153 drn=7）；fixture 錨點不符 → exit 1 | `agents.sh disable` | ✅ 2026-10-14 正式啟用：kick 後 last exit 0，restore-drills.log `pass`（product=3 tables=153 drn=7），無殘留容器；截斷 dump（head -c 4096）→ exit 1、`pg_restore failed`、log `fail` |
| P12-20 | 監看 `drn-monitor.sh`（heartbeat 各項、D25 自動補啟、黏住狀態、jobs 寬限、simpay、isolation、ALERT 游標、Access 漂移）；[ops/alerts.md](ops/alerts.md) | C＋U | P12-04、P12-08 | monitor 8 測試 → 0；5 個反向測試 RED；主機演練 (a)–(d) 見 alerts.md | `agents.sh disable drn.monitor` | 🟡 2026-10-14 已啟用 drn.monitor：首輪 heartbeat ok、alert ok；演練 (a) 不設旗標停 drn-worker → `fail containers:drn-worker`＋monitor.log `auto-up` → worker healthy；(b) `alert-selftest` → 400 `0\|Session mismatch`、一行 [ECPAY-ALERT] → `ALERT x1`，下一輪仍 fail，`drn-maint ack alerts` 後 ok。**(c)(d) 與手機通知等 U-23（Healthchecks／UptimeRobot）**；Tunnel 通知 2026-10-14 已建。正式 access-baseline 2026-10-14 已記（Access 建好、ingress public 之後）。另：monitor.log 有一次 `fail jobs`（09:13:48Z），但 worker 的 `[JOB-HEARTBEAT]` 每 10 分鐘都有、容器時鐘與主機差 0 秒、30 次重跑 0 次誤判，原因未查明，先記錄不改程式。2026-10-14 修正：tunnel 啟用時記下的 access-baseline 是 `status=none`（本機 macOS 解析器對新主機名稱留著「查無」快取，探測根本沒到 Cloudflare），漂移檢查等於沒在比。現在沒有 HTTP 回應一律回報 `access-unreachable`、也不准記成基準（monitor 測試 9 → 0；舊腳本跑新測試 → 1）；錯的基準改名為 `access-baseline.invalid-20261014`，正式基準等 Access 建好後再記 |
| P12-19 | 開機自動恢復：`drn.compose-up`、Docker Desktop 重啟演練、整機重開（Aki 在場） | C＋U | P12-20 | compose-up last exit 0；重開後 10 分鐘內 4 容器 healthy、公開 /health OK | `agents.sh disable drn.compose-up` | 🟡 2026-10-14 已啟用 drn.compose-up：首輪 last exit 0（`compose-up:ok`）；反向 A 維護旗標 → exit 3 `compose-up:maintenance`；反向 B 移除 current 標籤 → exit 5 `compose-up:up`（compose 想重建 worker 而失敗，舊容器保留），補回標籤後 exit 0、兩容器在 current。**Docker Desktop 重啟會影響 Aki 自己的容器，依 §1b 不由 CODE 做；整機重開演練等 U-21** |
| P12-10 | 公開網址綠界沙箱演練（ReturnURL、PaymentInfoURL 真實回呼；物流自簽通知；旗標只經 drn-drill） | C＋U | P12-22、P12-20 | status captured=true、proof_keys 含 ecpay_notice；access log 來源非 Mac IP；alertscan 0 | `drn-drill.sh simpay off` | ⛔ 等公開網址 |
| P12-11 | 升級與回滾：`drn-deploy.sh`（帳本、pre dump、retag、遷移、指紋）、`drn-rollback.sh`（sha256、C11 指紋閘門、pre-rollback、預演、`--accept-loss`） | C＋U | P12-10、P12-21 | deploy 測試 5 → 0；4 個反向測試 RED；主機：部署後寫入一筆 → 回滾 exit 4；Aki 核准後 → 0 | 用需要的版本再 deploy | ✅ 2026-10-14 真實演練（沙箱資料；Aki「給你最高權限完成該專案所有任務」）：deploy c9bebe9905e2→d9745a2325a0 15 秒；部署後一筆演練訂單 → rollback exit 4（列出筆數）；竄改的 pre dump → exit 2；`--accept-loss` → 16 秒完成，pre-rollback dump 保留、兩次還原演練 pass、回到 c9bebe9905e2、指紋回 8f856e82201e；**RTO 實測 16 秒**。演練中修正：rollback 列出被丟掉的綠界交易、錯誤訊息（cddc2e6） |
| P12-09 | 部署後盤點 `drn-inventory.sh compare` | C | P12-11 | unexpected=0 | 依各任務 | ✅ 2026-10-14：`compare inventory-pre.txt inventory-post.txt` → unexpected=0（新增只有 drn 容器／資料卷／網路／映像、3961、4 個 drn.* LaunchAgent）；launchd 中 drn.* 4 個。2026-10-14 改 public ingress 後再比：`compare inventory-pre.txt inventory-post-public.txt` → unexpected=4，全部是 macOS `rapportd`（AirDrop／接續互通）隨機監聽埠換號（52464/52465 → 52468/52469），不是 drn 造成；drn 相關新增仍只有允許清單內項目。比對規則不放寬 |
| P12-23 | 文件：deploy-backend.md 改寫；backup-restore／alerts／edge-cloudflare／pii-incident；DEV_PLAN 更新 | C | — | `grep -cE 'Supabase\|151\.145\|certbot\|docker save' docs/ops/deploy-backend.md` → 0；4 份 ops 文件存在；test-all 0 | git revert | ✅（本提交） |
| P12-07 | Vercel 前台 | C＋U | P7、G2 | — | — | ⏸ A7 的 MVP 不含前台 |
| P12-12 | 暫時頁：`dr.nature.smilelife.tw`（VPS nginx 靜態頁＋TLS） | C | — | 見原列 | 見原列 | ✅ 2026-10-13 上線（憑證到 2027-01-10）；A7 不動 VPS |
| P12-26 | 預覽版前台 `apps/storefront`（Next.js 16.4.0 靜態輸出＋three 0.186.1，2026-10-14 查證）：依 DESIGN 原型（只存在於 Aki 2026-10-13 的兩段螢幕錄影；repo、GitHub、舊電腦 zip 都沒有原型檔）重建：左側固定選單＋首頁故事索引 01～06＋購物車框、六段首頁故事、即時 3D 瓶身、三款商品頁、研發、品牌故事、知識誌（6 篇範例題目）、團購合作、會員（即將開放）、FAQ、退換貨、隱私、條款；帳密保護、noindex；取代 VPS 暫時頁 | C＋U | P12-12、G5／G2 暫用推薦稿與暫定品名（Aki 2026-10-14 決定） | `pnpm --dir apps/storefront typecheck && pnpm --dir apps/storefront build` 離場碼 0；`node scripts/claims-lint.mjs` 掃建置後 HTML 全部 0 error；`curl -sSI https://dr.nature.smilelife.tw/` 為 401 且含 `www-authenticate: Basic realm="Dr.Nature preview"` 與 `x-robots-tag: noindex`；`http://` 301；ACME 路徑 404 非 401；輸入帳密後首頁 200 | `sudo install /opt/drn/drn.conf.prev /etc/nginx/sites-available/drn.conf && nginx -t && systemctl reload nginx`（回到暫時頁，md5 f9dd6f1d…） | ✅ 2026-10-14 第一版（12 頁）上線後，Aki 指出前台應為 DESIGN 原型的 3D 官網並決定品名（01 日日順、02 晶亮、03 安和；「舒敏」為禁用詞改名，claims-lint 對「晶亮」仍有 80 則 warn，Aki 決定保留；G2 由此裁決，catalog.json 仍為 A/B/C 待同步）。重建後 typecheck 0、build 0（22 頁、2.6 MB）、claims-lint 23 頁 0 error／80 warn（反向：`幫助改善便秘` → 1）；瀏覽器 DOM 檢查：3 個 WebGL canvas 建立、console 0 error、六段 section、無橫向溢出；版面驗收（Aki 還原視窗後，瀏覽器在 1280×800 與 375×812 用 DOM 量測＋截圖）：修正側欄 wordmark 被 flex 拆開、習慣標題三行、首頁 hero 超出一屏（改為一屏高、瓶身絕對定位浮在文案右側並疊在大字上，Bottle3D 內嵌 position 移除；desktop 量測：hero 30→800、瓶身盒 606–1257 在 hero 內且不壓到英文副句、大字在首屏；mobile 無橫向溢出）；第三次部署 release 45951cb6db4f（476 KiB）、drn.conf 未變。 2026-10-14 Aki 指出缺少 Scroll up 效果 → 加入 GSAP 3.15.0 ScrollTrigger（npm view 查證；免費授權）：01 hero 釘住、02 以階梯狀直欄擦入並覆蓋、03 舞台釘住三段、編號／品名／tab 進度與 3D 標籤隨捲動 01→02→03 並轉動、04 全幅面板縮成內嵌卡、05 情境卡隨捲動橫移、06 全幅面板縮小；prefers-reduced-motion 全部關閉。驗收（瀏覽器逐段捲動量測，桌機 1280×800 與手機 375×812）：hero 在 y=300～600 為 fixed 且 top=0，s02 階梯 scaleY 0→1；03 舞台在 y≈1500～3400 為 fixed 且 top=0，active 0→1→2，tab 進度 0→1；console 無站內錯誤。找到並修正：`main` 的進場動畫含 transform，使釘住元素的 fixed 失效（改為只動 opacity）。第四次部署 release 969c401c130d（518 KiB）。影像與影片槽位（D-E01／E03）為佔位：DESIGN 原型本身也未產出素材；test-all 新增 storefront:typecheck／build 兩個 suite（反向：型別錯誤 → 2、缺商品頁 → 1）。Aki 在 Terminal.app 用 `htpasswd -c -m` 產生密碼檔（內容未經對話）並核准 VPS 寫入後，`infra/vps/drn-preview-deploy.sh` 部署：release `937c2ec8a0d4`（251 KiB）、`/opt/drn/drn.htpasswd` 640 root:www-data、舊 conf 備份 `/opt/drn/drn.conf.prev`（md5 f9dd6f1d…）、`nginx -t` 通過後 reload；遠端 drn.conf md5 `d34cb7bd…` 等於 repo；外部：`/` 與 `/story/` 401 + `www-authenticate: Basic realm="Dr.Nature preview"` + `x-robots-tag: noindex, nofollow`，錯密碼 401，`http://` 301，ACME 探測 404；VPS 盤點前後：sites-enabled 66、容器 57、磁碟 4.9 GB 可用，未動非 drn 資源。**不能證明**：輸入正確帳密後整站可瀏覽（CODE 沒有密碼，由 Aki 在客戶的裝置實測；LINE 內建瀏覽器的帳密框 TODO(需查證)）；視覺是 CODE 暫用版，等 DESIGN D-01～D-06 |
| P12-25 | G-PII 閘門：收真實個資前——獨立使用者或專用主機、管理員 MFA、源站驗 Access JWT、Redis requirepass、R2 離線演練、UPS、Time Machine 排除、D21 書面紀錄、D24 主機服務加固後重跑探測 | U＋C | P12-11 | 每項都要證據 | — | ⛔ |

### P13 上市營運

| ID | 任務 | 負責 | 前置 | 驗收 | 狀態 |
|---|---|---|---|---|---|
| P13-01 | 團購招商啟動（照 groupbuy-launch-runbook：五把鑰匙 → D0 品牌建檔 → D1 名單三閘門 → 招商信） | C＋U | P8-08 | Runbook 各步驟離開條件 | ⛔ |
| P13-02 | 電商平台上架評估（momo、蝦皮、酷澎等）與價格紀律 | C | P1-07 | 策略文件核准 | ⛔ |
| P13-03 | Dr.Grey 建品牌、跑首次稽核、排 pillar／cluster 內容計畫 | C＋U | P6-05 | 稽核分數與待辦清單 | ⛔ |
| P13-04 | DigiAds 建品牌、接 Pixel／CAPI、首波廣告 | C＋U | P8-05 | DigiAds 預檢通過 | ⛔ |

### P14 品牌官網迭代（2026-10-14 稽核；目標「world top-tier health care brand」）

> 來源：2026-10-14 稽核 workflow——八個視角（UX/IA、視覺、捲動與 3D 跨裝置、無障礙與效能、法規文案、LINE OA 官方文件、後端就緒度、裝置測試矩陣）各自對 `apps/storefront/out`（本機建置 438b188）量測、引用 file:line 與已抓取的官方文件，再由合併代理去重成 77 條最小任務（原始 JSON 在工作階段 scratchpad，證據摘要寫在各列）。反證階段（60 個懷疑者）因使用量上限沒有跑完：改由各實作車道在動手前對照原始碼驗證，合併後再做一次審查。
> 執行模式（Aki 2026-10-14 要求最高平行度、嚴禁重工）：七條車道各在獨立 worktree（分支 `lane/A-backend-line`…`lane/G-line-content`，基底 438b188）、檔案所有權互斥、一任務一提交 `[編號] 標題`，由 CODE 合併進本分支後跑完整 `scripts/test-all.sh`、重佈預覽站（部署前另報 Aki）。車道：A 後端＋LINE 管線（BR/LINE/BE）、B 捲動與 3D（MO/PF-03）、C 文案與知識誌資訊架構（CC/UX-02/08/11）、D 導覽與無障礙與字型（UX/AC/PF-02/05）、E 視覺 CSS 與對比（VI/AC-02/03/TL-02/MO-04）、F 測試基礎建設（TL-01/PF-04/CC-07/PF-01）、G LINE 內容與規格（LN-03/04 的文字與 JSON）。
> **等 Aki 的閘門**：G5（主句：預設 slogan.md 推薦稿「少說一點，說準一點。」，或把 DESIGN 的「以科學，讀懂自然」送進 slogan.md 評審簽核）→ CC-01；G3 重裁（消費者客服人設需要 webhook 歸 Medusa ② 或轉發器 ③；未決前前台只承諾「開賣與會員開放時通知」）→ LN-01、UX-05/15/16；U-12 延伸（研發長肖像與名義的書面同意補列 LINE OA 人設、圖文選單、推播）→ CC-08、LN-02；U-01（輪替外露的 LINE Channel secret／token，值由 Aki 寫進主機）→ 任何 webhook／Messaging API 上線；U-17（Login channel Callback、連結官方帳號）→ LN-05；VPS 重佈（gzip／Cache-Control、新版前台）逐次核准；Cloudflare 變更（/hooks/line/webhook 的 Access Bypass、tunnel、WAF）逐項核准；真機實測（iOS Safari、Android Chrome、LINE 內建瀏覽器）由 Aki 執行並回報。
> 狀態符號：🔄 車道進行中（合併後改 ✅ 並補證據）、⛔ 等閘門、⬜ 未排。

| 編號 | 任務 | 優先/量 | 負責 | 驗收（指令與預期輸出） | 回滾 | 狀態 |
|---|---|---|---|---|---|---|
| TL-01 | Commit the cross-engine scroll/3D probe as a repo script with exit co… | P0/M | 車道 F | `STOREFRONT_MATRIX=1 node scripts/storefront-matrix.mjs; echo $?` prints the 3-engine x 4-profile table and 0 on the current build (results.json shows all assertions hold today); the two negative runs exit non-zero; `bash scripts… | git revert; the suite line disappears from test-all.sh. | 🔄 進行中 |
| TL-02 | Committed WCAG contrast check (text >= 4.5:1, UI >= 3:1) wired into t… | P0/S | 車道 E | `node scripts/contrast-check.mjs apps/storefront/app/globals.css; echo $?` prints the table and 1 on the current CSS (14 failing rows); after AC-02/AC-03/VI-03 it prints 0; `bash scripts/test-all.sh` lists the suite. | git revert. | 🔄 進行中 |
| MO-01 | Derive the 03 stage's active step from progress in onRefresh instead … | P0/S | 車道 B | TL-01 probe: load /, scrollTo(#s03.offsetTop + 1.5*innerHeight), wait 300ms, setViewportSize(height-100), wait 700ms → `#s03 [data-step][data-active]`.dataset.step === '1' and the 2nd `#s03 .tabs a` has aria-current, in chromium … | git revert (single file). | 🔄 進行中 |
| MO-02 | Load Noto Sans TC (with the label strings) before drawing the 3D labe… | P0/S | 車道 B | TL-01-style Playwright run with addInitScript hooking CanvasRenderingContext2D.prototype.fillText: on / and /products/daily/ in chromium desktop, chromium mobile and webkit, every fillText whose font contains 'Noto Sans TC' has d… | git revert; the label returns to immediate drawing. | 🔄 進行中 |
| MO-03 | Account for the 56px mobile top bar in the hero height and in both pi… | P0/S | 車道 B | TL-01 probe at the iPhone 14 and Pixel 7 profiles (chromium + webkit): at every sampled y where #s01 is fixed, `.hero-copy`.getBoundingClientRect().top >= `.topbar` bottom; at every y where `.three` is fixed, `#s03 .left .kicker`… | git revert. | 🔄 進行中 |
| MO-04 | Restore the unprefixed backdrop-filter dropped by Lightning CSS (top … | P0/S | 車道 E | `grep -o '[-a-z]*backdrop-filter:blur(10px)' apps/storefront/out/_next/static/chunks/*.css ｜ sort -u` prints both `-webkit-backdrop-filter:blur(10px)` and `backdrop-filter:blur(10px)` (today only the -webkit- form); TL-01 chromiu… | git revert. | 🔄 進行中 |
| VI-01 | Restore the CSS bottle rules used by SeriesCards (home and /products/) | P0/S | 車道 E | `grep -cE '^\.(stand｜bottle)' apps/storefront/app/globals.css` >= 6; `grep -c '\.bottle' apps/storefront/out/_next/static/chunks/*.css` >= 1; TL-01 screenshot at 1280 and 375 of `.pcard .stage` shows a bottle silhouette with the … | git revert. | 🔄 進行中 |
| UX-01 | Mobile menu: close on navigation and hash change, Escape closes and r… | P0/S | 車道 D | `cd apps/storefront && pnpm exec tsc --noEmit && pnpm exec next build` exit 0; `grep -c 'open=""' apps/storefront/out/index.html` → 0; TL-01 probe at 756x900: Enter on summary → details.open true; Escape → open false and document… | git revert. | 🔄 進行中 |
| AC-01 | Clear the serious axe rules and the broken aria-labelledby (marquee, … | P0/S | 車道 D | @axe-core/cli 4.13.0 (--tags wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa,best-practice --load-delay 4000) over all 22 out/**/index.html: aria-prohibited-attr = 0, scrollable-region-focusable = 0, incomplete aria-valid-attr-value = 0… | git revert. | 🔄 進行中 |
| AC-02 | Use the existing --red-2 (#b81f15, 5.68:1) for small red text; keep -… | P0/S | 車道 E | `node scripts/contrast-check.mjs ...` rows kicker / ptag / jcard .cat / hero-meta b >= 4.5 PASS; axe-core 4.13.0 color-contrast violations = 0 on all 22 pages at three viewports; `getComputedStyle(document.querySelector('.kicker'… | git revert. | 🔄 進行中 |
| AC-03 | Make the 06 dark panel AA: darker gradient stops, white focus ring, t… | P0/S | 車道 E | contrast-check rows 'panel-dark' (all stops), 'btn.light border', 'focus ring on panel-dark' PASS; probe2.cjs-style sampling at the vertical centre of .btn.light and .panel-dark .kicker gives >= 4.5:1; axe on /: 0 violations and … | git revert. | 🔄 進行中 |
| CC-01 | Replace the hero slogan with the G5 interim line, or put DESIGN's lin… | P0/S | Aki G5 | `grep -c '以科學' apps/storefront/out/index.html` → 0 and `grep -c '少說一點' apps/storefront/out/index.html` → >= 1 (or, for option B, slogan.md contains a 候選四 section naming the rule-4 conflict and Aki's sign-off date); `node scripts/… | git revert; rebuild. | ⛔ |
| CC-02 | Rewrite home section 02 / story opener: drop 「保健品，總是說得太多」 and the abs… | P0/S | 車道 C | `grep -rc -E '保健品｜我們只說' apps/storefront/out --include=index.html ｜ awk -F: '{s+=$2} END {print s}'` → 0; `node scripts/claims-lint.mjs apps/storefront/out` → 0 error. | git revert; rebuild. | 🔄 進行中 |
| CC-03 | Remove eye, seasonal and organ wording from the 知識誌 categories and sa… | P0/S | 車道 C | `grep -rc -E '用眼｜換季｜腸道' apps/storefront/out --include=index.html ｜ awk -F: '{s+=$2} END {print s}'` → 0; `grep -c '眼' apps/storefront/out/index.html` → 0; `node scripts/claims-lint.mjs apps/storefront/out` → 0 error. | git revert; rebuild. | 🔄 進行中 |
| CC-04 | Use the catalog series name 「益生菌系列／Probiotic Series」 until P2-01 appr… | P0/S | 車道 C | `grep -rc -E '菌相｜DAILY FLORA｜Daily Flora' apps/storefront/out --include=index.html ｜ awk -F: '{s+=$2} END {print s}'` → 0; `grep -c 'DAILY FLORA' apps/storefront/app/components/Bottle3D.tsx` → 0; `node scripts/claims-lint.mjs app… | git revert; rebuild. | 🔄 進行中 |
| CC-07 | Make claims-lint scan the real storefront source and the built HTML i… | P0/S | 車道 F | `node scripts/claims-lint.mjs; echo $?` → '0 error(s)' and 0; `node scripts/claims-lint.mjs apps/storefront/out` → 0 error; `bash scripts/test-all.sh` lists claims-lint:storefront-out; the negative run exits 1. | git revert. | 🔄 進行中 |
| CC-08 | Gate /rd/ (director name, degree, title) on written U-12 consent befo… | P0/S | Aki U-12 | DEV_PLAN U-12 row shows ✅ with a date before the preview password is removed; `grep -c '鄭安生' apps/storefront/out/rd/index.html` → 0 when built without the flag and >= 1 with it; `node scripts/check-env-names.mjs` passes with the … | git revert; U-12 row unchanged. | ⛔ |
| CC-09 | Align the LINE block promise with G3 and the privacy/FAQ sentences wi… | P0/S | 車道 C | `grep -c '補貨提醒' apps/storefront/out/index.html` → 0 unless Aki re-decided G3 (then DEV_PLAN G3 row shows ② or ③ with a date); `grep -c '尚未開放' apps/storefront/out/privacy/index.html` → >= 1; `node scripts/claims-lint.mjs apps/stor… | git revert; rebuild. | 🔄 進行中 |
| UX-02 | Replace the dead ?cat= journal tabs with static category pages | P0/M | 車道 C | `pnpm exec next build` exit 0; `ls apps/storefront/out/journal/c/*/index.html ｜ wc -l` → 4; `grep -rc 'journal/?cat=' apps/storefront/out/index.html apps/storefront/out/journal/index.html` → 0 each; `grep -c 'class="jcard"' apps/… | git revert. | 🔄 進行中 |
| MO-05 | Stop the CSS reveal and GSAP from both writing transform on the 05 sc… | P1/S | 車道 B | TL-01 probe chromium + webkit, desktop and mobile: 2.5s after load `getComputedStyle(document.querySelector('#s05 .scene:nth-child(1)')).transform` ends with ', 0, -28)' and nth-child(2) ends with ', 0, 0)' in all four runs (toda… | git revert (two files). | 🔄 進行中 |
| MO-06 | Render each 3D bottle only while its canvas is on screen | P1/S | 車道 B | TL-01-style run with a rAF-count hook: at scrollY = #s05.offsetTop (no canvas on screen) rAF callbacks over 1s <= 70 and data-frame of all three hosts unchanged for 2s; at scrollY 0 >= 50; scrolling back to #s03.offsetTop + inner… | git revert. | 🔄 進行中 |
| MO-07 | Pre-check WebGL 2 and show the static slot on context loss / restore | P1/S | 車道 B | TL-01 `--no-webgl` run (chromium --disable-webgl --disable-webgl2 --disable-3d-apis): console error count 0, `.stage3d .slot` = 3 on / and 1 on /products/daily/, canvases 0 (today 9 errors). With WebGL: `document.querySelector('.… | git revert. | 🔄 進行中 |
| MO-08 | Use svh instead of dvh for the choreographed sections and set ignoreM… | P1/S | 車道 B | TL-01 probe chromium mobile + webkit mobile (375x812, hasTouch): record #s04 .daily-panel offsetTop/offsetHeight and #s06 offsetTop, setViewportSize({height:740}), wait 800ms → all three unchanged (with dvh the panel height drops… | git revert. | 🔄 進行中 |
| MO-09 | Land cold-loaded /#s0N deep links on the pinned section start | P1/S | 車道 B | TL-01-style run (1440x900 and 500x800): for each of /#s02…/#s06 the target section's bounding top is 0 ± 2px 2.5s after load; in-page index clicks unchanged (s02 757, s03 1273, s06 5650 at 1280x800). | git revert. | 🔄 進行中 |
| MO-10 | Scope smooth scrolling so programmatic scrolls do not animate through… | P1/S | 車道 B | TL-01 chromium desktop: `window.scrollTo(0, 2500)` then after 50ms scrollY === 2500; clicking the side index link for 03 ends with #s03.getBoundingClientRect().top === 0 within 1.5s; MO-01 acceptance still passes. | git revert. | 🔄 進行中 |
| MO-11 | Remove the 8px horizontal overflow of .contact > div on WebKit phones | P1/S | 車道 E | TL-01 webkit iPhone 14 profile: documentElement.scrollWidth === 375 and body.scrollWidth === 375 2.5s after load, with and without .fx; chromium unchanged (375). | git revert. | 🔄 進行中 |
| MO-12 | Pin the hero with CSS position: sticky instead of a ScrollTrigger pin… | P1/M | 車道 B | TL-01 chromium desktop with PerformanceObserver('layout-shift', buffered) and 36 x page.mouse.wheel(0,50): no entry whose sources include SECTION#s01 and total (hadRecentInput=false) < 0.1 (today 0.63); choreography unchanged in … | git revert; the ScrollTrigger pin returns. | 🔄 進行中 |
| PF-03 | Start import('three') from an IntersectionObserver (rootMargin 300px)… | P1/S | 車道 B | Lighthouse 13.5.0 mobile (gzip server) on /: the three chunk is absent from the LCP critical chain (network-dependency-tree insight) and home LCP drops by >= 800 ms versus the post-PF-02 number; TL-01: 3 canvases still present af… | git revert. | 🔄 進行中 |
| VI-02 | Keep the hero bottle inside the hero at 1024-1200px widths | P1/S | 車道 E | TL-01 at 1024x768, 1194x834 and 1280x800: `s=.hero-stage .stage3d rect; h=.hero rect; s.right <= h.right - 16` true and s.width === s.height. | git revert. | 🔄 進行中 |
| VI-03 | Visible form boundaries, placeholder, dashed pending tags and the her… | P1/S | 車道 E | contrast-check rows 'nl input border', 'soon input border', 'placeholder', 'pending-list dashed', 'hero-video tag' PASS; `grep -c 'opacity: 0.75' apps/storefront/app/globals.css` = 0; `grep -cE '^\.(nl｜soon) input' apps/storefron… | git revert. | 🔄 進行中 |
| VI-04 | Add plain fallbacks before color-mix() and every dvh/svh so older iOS… | P1/S | 車道 E | `node -e "const l=require('fs').readFileSync('apps/storefront/app/globals.css','utf8').split('\n');let bad=0;l.forEach((s,i)=>{if(/\d(d｜s)vh/.test(s)){const p=l[i-1]｜｜'';const prop=s.split(':')[0].trim();if(!(p.includes(prop+':')… | git revert. | 🔄 進行中 |
| VI-05 | Self-host one Latin display face so the wordmark, marquee, numerals a… | P1/M | 車道 E | TL-01 at 1280x800 in chromium, webkit and firefox: `.giant`.getBoundingClientRect().width equal within ±1px across engines and `document.fonts.check('700 80px <face>')` true after load; `grep -n 'Helvetica' apps/storefront/app/gl… | git revert; fonts dir removed. | 🔄 進行中 |
| VI-06 | Footer: both legal disclaimer lines and a two-column legal grid | P1/S | 車道 E | `grep -c '本產品非健康食品' apps/storefront/out/index.html` >= 1; `node scripts/claims-lint.mjs apps/storefront/out` 0 error; TL-01 screenshots at 760 and 1024 show no `.legal` span breaking mid-sentence (Aki check). | git revert. | 🔄 進行中 |
| UX-03 | Give /account/ (the cart and 會員 destination) a real next step | P1/S | 車道 D | `grep -c '<input' apps/storefront/out/account/index.html` → 0; `grep -c 'href="/products/"' apps/storefront/out/account/index.html` increases by 1 versus the current build; `node scripts/claims-lint.mjs apps/storefront/out` → 0 e… | git revert. | 🔄 進行中 |
| UX-04 | Anchor every FAQ item and open the one named in the URL hash | P1/S | 車道 D | `grep -c '<details id="' apps/storefront/out/faq/index.html` → 10; `grep -c 'id="buy"'` → 1; `grep -c 'id="differences"'` → 1; build 0. | git revert. | 🔄 進行中 |
| UX-05 | PDP buy row: deep links to the purchase and comparison FAQ, LINE noti… | P1/S | 車道 D | `grep -c 'href="/faq/#buy"' apps/storefront/out/products/daily/index.html` → 1; `grep -c 'href="/faq/#differences"'` → 1; `node scripts/claims-lint.mjs apps/storefront/out` → 0 error. | git revert. | 🔄 進行中 |
| UX-06 | Add a 關於 column to the footer sitemap | P1/S | 車道 D | `before=$(grep -o 'href="/story/"' apps/storefront/out/faq/index.html ｜ wc -l)`; after rebuild the same command returns before+1; `grep -c '>關於<' apps/storefront/out/faq/index.html` → 1. | git revert. | 🔄 進行中 |
| UX-07 | Add the 01-06 home-story index to the mobile menu | P1/S | 車道 D | `grep -o 'href="/#s03"' apps/storefront/out/index.html ｜ wc -l` → 2 (was 1); same for /#s06. | git revert. | 🔄 進行中 |
| UX-08 | Remove internal ticket IDs and process notes from visitor-facing stri… | P1/S | 車道 C | `grep -l -E 'D-E0[13]｜O-06｜O-10｜範例題目' apps/storefront/out/index.html apps/storefront/out/*/index.html apps/storefront/out/*/*/index.html` → no output; `node scripts/claims-lint.mjs apps/storefront/out` → 0 error. | git revert. | 🔄 進行中 |
| UX-10 | Fix doubled page titles and give the 404 page its own title | P1/S | 車道 D | `for f in faq privacy terms; do grep -o '<title>[^<]*</title>' apps/storefront/out/$f/index.html; done` → each contains exactly one '｜Dr.Nature'; `grep -o '<title>[^<]*</title>' apps/storefront/out/404.html` contains 找不到這一頁. | git revert. | 🔄 進行中 |
| UX-11 | Give placeholder posts a way forward: sibling topics and the contact … | P1/S | 車道 C | `grep -c 'href="/journal/' apps/storefront/out/journal/read-the-label/index.html` → >= 3; `node scripts/claims-lint.mjs apps/storefront/out` → 0 error. | git revert. | 🔄 進行中 |
| AC-04 | Repair the heading outline and landmarks (story h2 before h1, h1→h3 j… | P1/S | 車道 D | axe-core 4.13.0: heading-order = 0 and region = 0 on all 22 pages; heading audit script prints story 'h1 h2 …', products 'h1 h2 h2 h2 h2 …', journal h1 text '知識誌'. | git revert. | 🔄 進行中 |
| AC-05 | Pause control for the marquee and the auto-rotating bottles (WCAG 2.2… | P1/S | 車道 D | TL-01: click .marquee-pause → `getComputedStyle(document.querySelector('.marquee .track')).animationPlayState === 'paused'` and aria-pressed 'true'; data-frame of the three canvases constant for 2s; axe 0 new violations. | git revert. | 🔄 進行中 |
| CC-05 | Replace the four placement scenes (窗邊／餐桌／玄關／書桌) with non-placement sc… | P1/S | 車道 C | `grep -rc -E '窗邊｜玄關｜餐桌｜書桌' apps/storefront/out --include=index.html ｜ awk -F: '{s+=$2} END {print s}'` → 0; `node scripts/claims-lint.mjs apps/storefront/out` → 0 error. | git revert. | 🔄 進行中 |
| CC-06 | Reword 「法規審核」 to internal-review wording (absorbs UX-09) | P1/S | 車道 C | `grep -rc -E '法規審核｜審核中' apps/storefront/out --include=index.html ｜ awk -F: '{s+=$2} END {print s}'` → 0; `node scripts/claims-lint.mjs apps/storefront/out` → 0 error. | git revert. | 🔄 進行中 |
| PF-01 | gzip and immutable Cache-Control for the preview storefront in drn.co… | P1/S | 車道 F | nginx -t exit 0 on the VPS; with the preview password `curl -sI -H 'Accept-Encoding: gzip' https://dr.nature.smilelife.tw/_next/static/chunks/<three chunk>.js` shows content-encoding: gzip, cache-control: public, max-age=31536000… | ssh … 'sudo install /opt/drn/drn.conf.prev /etc/nginx/sites… | 🔄 進行中 |
| PF-02 | Self-host Noto Sans TC with next/font/google, two weights, no cross-o… | P1/M | 車道 D | Lighthouse 13.5.0 mobile (gzip local server): 0 requests to fonts.googleapis.com or fonts.gstatic.com; no cross-origin render-blocking stylesheet; font transfer on / <= 600,000 B (baseline 869,420); home LCP at least 1,500 ms bel… | git revert (restores the Google Fonts link). | 🔄 進行中 |
| PF-04 | Repeatable a11y/perf gate: axe 4.13.0 + lighthouse 13.5.0 with exit c… | P1/M | 車道 F | `bash scripts/audit-storefront.sh; echo $?` exits 0 on a passing build and prints axe serious=0 critical=0, CLS, LCP; the two negative runs exit 1; the script writes nothing inside apps/storefront except out/. | git revert; delete the scratch tool dir. | 🔄 進行中 |
| DM-01 | Open the DESIGN ticket batch that the gates above depend on | P1/S | CODE→DESIGN 開單 | `grep -c -E 'AC-02｜AC-03｜AC-05｜VI-05｜PF-05｜PF-06｜MO-10｜CC-05' design/QUESTIONS.md` → 8. | git revert. | ⛔ |
| MO-13 | Refresh ScrollTrigger once the web fonts are ready | P2/S | 車道 B | TL-01 chromium desktop with a 4s delay route on **/fonts.gstatic.com/**: after document.fonts.ready the `.pin-spacer` heights equal [#s01.offsetHeight, 3*innerHeight] and scrolling to #s03.offsetTop + 5 gives `.three` fixed top 0… | git revert. | 🔄 進行中 |
| MO-14 | React to prefers-reduced-motion changes at runtime | P2/S | 車道 B | TL-01 chromium: load with no preference (.pin-spacer 2, html.fx present); page.emulateMedia({ reducedMotion: 'reduce' }) → html.fx absent, .pin-spacer 0, rAF/s <= 10; back to 'no-preference' → html.fx present, .pin-spacer 2. | git revert. | 🔄 進行中 |
| MO-15 | Allow pinch-zoom on the 3D hosts (touch-action: pan-y pinch-zoom) | P2/S | 車道 B | TL-01: `getComputedStyle(el).touchAction === 'pan-y pinch-zoom'` for all .stage3d hosts on / and the PDP; a horizontal mouse drag over the canvas still changes the rendered frame. | git revert. | 🔄 進行中 |
| MO-16 | Re-apply the pixel ratio when devicePixelRatio changes | P2/S | 車道 B | TL-01 chromium via CDP Emulation.setDeviceMetricsOverride deviceScaleFactor 1 → 2 at 1280x800: the hero canvas width attribute doubles within 500ms while clientWidth stays constant. | git revert. | 🔄 進行中 |
| MO-17 | Single tilt source and a floor-locked contact shadow for the 3D bottle | P2/S | 車道 B | Hero bottle axis in a 1280x800 screenshot = 8° ± 1°; section-04 shadow ellipse major axis horizontal (0° ± 1°); `grep -c 'rotate(-8deg)' apps/storefront/app/globals.css` = 0. | git revert. | 🔄 進行中 |
| MO-18 | Share one WebGL renderer across the three home bottles (scissor rende… | P2/L | 車道 B | TL-01 chromium desktop on /: document.querySelectorAll('canvas').length === 1; the three stage regions are non-blank at y=0, y=#s03.offsetTop+ih, y=#s04.offsetTop; console errors 0; MO-06 rAF budget still met. | git revert to per-host renderers. | 🔄 進行中 |
| VI-07 | Un-dim the section-02 headline when motion is reduced or GSAP is abse… | P2/S | 車道 E | TL-01 with reducedMotion emulated: after scrolling #s02 into view `getComputedStyle(document.querySelector('#s02 .dim')).color === 'rgb(241, 240, 236)'`; `grep -c '<h2 data-reveal' apps/storefront/out/index.html` >= 1. | git revert. | 🔄 進行中 |
| VI-08 | Raise mobile tap targets to the brief's 44px (cart box, menu, journal… | P2/S | 車道 E | TL-01 at 375: `[...document.querySelectorAll('a,button,summary')].filter(e => !e.closest('p,.legal') && e.getBoundingClientRect().height < 44).length` = 0 on /, /journal/, /products/daily/. | git revert. | 🔄 進行中 |
| VI-09 | Lower the giant wordmark's clamp floor so it never clips at 320-375px | P2/S | 車道 E | TL-01 at 320, 360 and 375px: `g=.giant; h=.hero; g.scrollWidth <= h.clientWidth - 32` true. | git revert. | 🔄 進行中 |
| VI-10 | Interim type-size token scale (replaces 36 distinct font-size values) | P2/M | 車道 E | `grep -oE 'font-size: [^;]*' apps/storefront/app/globals.css ｜ sort -u ｜ wc -l` <= 12; `grep -rn 'fontSize' apps/storefront/app --include=*.tsx ｜ wc -l` = 0; build 0. | git revert. | 🔄 進行中 |
| VI-11 | Spacing tokens on a 4px rhythm for padding, margin and gap | P2/M | 車道 E | `grep -oE '(padding｜margin｜gap)[a-z-]*: [^;]*' apps/storefront/app/globals.css ｜ grep -oE '\b[0-9]+px' ｜ sort -un ｜ wc -l` <= 6; build 0; Aki screenshot compare at 1280 and 375 (±4px per block). | git revert. | 🔄 進行中 |
| VI-12 | Move every hard-coded colour into :root tokens; the 3D label reads co… | P2/S | 車道 E | `sed -n '23,$p' apps/storefront/app/globals.css ｜ grep -c '#[0-9a-fA-F]\{3,6\}'` = 0; `grep -rn '#[0-9a-fA-F]\{6\}' apps/storefront/app --include=*.tsx ｜ wc -l` = 0; contrast-check 0 failures. | git revert. | 🔄 進行中 |
| VI-13 | Unify duplicated components: buttons, inputs, spec tables, cards, tags | P2/M | 車道 E | `grep -cE '^\.(nl button｜rd-name dl｜label-table dl｜ptag｜jcard \.cat)' apps/storefront/app/globals.css` = 0; `grep -rc 'className="tag' apps/storefront/app` >= 3; build 0; Aki screenshot of /, /products/daily/, /rd/, /journal/. | git revert. | 🔄 進行中 |
| UX-13 | Visible breadcrumb on product pages and journal posts | P2/S | 車道 D | `grep -c 'aria-label="路徑"' apps/storefront/out/products/daily/index.html` → 1; same for out/journal/read-the-label/index.html; build 0. | git revert. | 🔄 進行中 |
| UX-14 | Canonical link on every page (P7-10 acceptance) | P2/M | 車道 D | `grep -L 'rel="canonical"' apps/storefront/out/index.html apps/storefront/out/*/index.html apps/storefront/out/*/*/index.html` → no output; `grep -o 'rel="canonical" href="[^"]*"' apps/storefront/out/products/daily/index.html` → … | git revert. | 🔄 進行中 |
| UX-15 | Returns placeholder: link to the purchase FAQ (and LINE if G3 allows) | P2/S | 車道 D | `grep -c 'href="/faq/#buy"' apps/storefront/out/returns/index.html` → 1; `node scripts/claims-lint.mjs apps/storefront/out` → 0 error. | git revert. | 🔄 進行中 |
| UX-16 | Route all LINE CTAs through /go/line so joins can be attributed | P2/M | G3 後 | `grep -rc 'line.me/R/ti/p' apps/storefront/out/index.html` → 0 and `grep -c 'href="/go/line"' apps/storefront/out/index.html` → >= 1; after deploy `curl -sI https://dr.nature.smilelife.tw/go/line` → 302 with location https://line… | restore drn.conf from /opt/drn/drn.conf.prev, nginx -t, rel… | ⛔ |
| UX-17 | When the newsletter goes live, add a consent checkbox and privacy link | P2/S | P8-02/04 後 | `grep -c 'id="nl-consent"' apps/storefront/out/index.html` → 1 once enabled; until then the hint '電子報將於正式上線後開放訂閱。' remains (grep -c → 1). | git revert. | ⛔ |
| PF-05 | Favicon via app/icon and app/favicon.ico (removes the 404 on every pa… | P2/S | 車道 D | `curl -sI http://127.0.0.1:3061/favicon.ico` → 200 on the local server; `grep -c 'rel="icon"' apps/storefront/out/index.html` >= 1; Lighthouse errors-in-console score 1 on /. | git revert. | 🔄 進行中 |
| PF-06 | Shorten the entrance fade on LCP headings and audit the Next polyfill… | P2/S | PF-02 後 | Lighthouse 13.5.0 /products/daily/ lcp-breakdown 'Element render delay' <= 150 ms with the h1 still the LCP element; legacy-javascript wastedBytes recorded before/after (no regression). | git revert. | ⛔ |
| LN-01 | Re-decide G3 before any consumer LINE OA persona work: who receives @… | P2/S | Aki G3 | docs/DEV_PLAN.md G3 row carries the new decision and date; the memo exists; no change in LINE Developers console (Aki confirms). | Decision reverted in DEV_PLAN; nothing deployed. | ⛔ |
| LN-02 | Extend the director's written consent (U-12) to the LINE OA persona, … | P2/S | Aki U-12 | DEV_PLAN U-12 row lists 'LINE OA' in scope with ✅ and date before LN-03 starts. | None (document only). | ⛔ |
| LN-03 | Write the LINE OA persona spec within the compliance scope (allowed /… | P2/M | 車道 G | `node scripts/claims-lint.mjs content/line` → 0 error; the file header shows three dated review rounds and Aki's sign-off; every allowed sentence maps to claims.md §2/§6 or cro.md 已驗證; a reviewer grep for 醫師｜推薦｜保證｜專利｜論文｜健康食品 in t… | git revert; file removed. | 🔄 進行中 |
| LN-04 | Rich menu: copy spec from the slogan rules, default menu via Messagin… | P2/M | 車道 G | `node scripts/claims-lint.mjs content/line` → 0 error; the menu is visible to a test account with the exact 主句/副句 strings (Aki screenshot); if API: the create/upload/set-default calls return 200 and the id is recorded in docs/ops… | Delete the rich menu (API or OA Manager); git revert. | 🔄 進行中 |
| LN-05 | Member binding: linked OA on the LINE Login channel (bot_prompt=norma… | P2/L | Aki U-17／G3 | `pnpm --dir apps/backend run test:integration:http` includes an account-link spec: valid nonce → binding row created; reused or unknown nonce → 400 and no row; `curl -s https://api.line.me/friendship/v1/status` with a test user t… | git revert; unlink rows deleted via admin. | ⛔ |
| LN-06 | Webhook receiver with x-line-signature verification and webhookEventI… | P2/M | 車道 A | `pnpm --dir apps/backend run test:unit` includes the three signature/dedupe tests green; negative test: flip one byte of the body → 400 asserted; LINE Developers webhook 'Verify' returns success (Aki); no secret logged (`grep -c … | Restore the previous webhook URL in LINE Developers; git re… | 🔄 進行中 |
| BE-01 | Rebase and merge feat/blog (Post/Category/Tag module) after test-all … | P2/M | 車道 A | `bash scripts/test-all.sh; echo $?` → 0 including backend:integration:http with integration-tests/http/blog.spec.ts; `git log --oneline main ｜ grep -c '\[P6-01\]'` → 1 after merge. | git revert the merge commit; migrations rolled back with th… | 🔄 進行中 |
| BE-02 | Rebase and merge feat/affiliate (Partner/Store/attribution) after tes… | P2/M | 車道 A | `bash scripts/test-all.sh; echo $?` → 0 including integration-tests/http/affiliate.spec.ts; the log shows '[affiliate] order … attribution' lines only in tests. | git revert the merge commit. | 🔄 進行中 |

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
- Mac mini 正式站：runbook 不能證明的事列在 [ops/deploy-backend.md](ops/deploy-backend.md) §7（FileVault 冷開機、cloudflared 轉送 X-Forwarded-Proto、綠界對 Cloudflare 的接受度、容器碰不到主機服務）。
