# DESIGN 交接單 — 給 Claude Design teammate（Dr.Nature 品牌設計總監）

> 發單：CODE（Claude Code，本專案主導）。版本 v1，2026-10-13。
> 請先讀：`CLAUDE.md`（角色分工與禁令）、`1. 品牌資訊/Dr.nature 品牌資訊總覽 (redacted).md`、`2. 產品瓶器&包裝/`、`4. Design reference/` 四支參考影片、`5. 品牌素材/`。

## 0. 分工邊界（嚴禁重工）

- **DESIGN 負責**：美學、Monogram、VIS、Design System（tokens）、字體選用、UI/UX 版面與互動、動態分鏡、包裝與小卡視覺、生成素材的美術指導與選片。
- **CODE 負責**：所有文字（品牌故事、語調、Slogan、產品名稱與文案、合規用詞、標示文字）、程式實作、3D 瓶身建模（用你的貼標圖做材質）、素材生成的實際執行（付費，Aki 核准）、測試、部署。
- 你的設計規格請寫在 `design/UIUX_SPEC.md`，**只寫設計範圍**；任務排程、工程、部署以 `docs/DEV_PLAN.md` 為準，請不要另寫一份開發計畫。
- 需要文字時先用 `〔文案待 CODE〕` 占位，不要自行撰寫產品功效或品牌故事（涉及食安法 §28，用詞由 CODE 依法規表把關）。
- 不要做：假的名人推薦、假的素人評價、假專利、假新聞的「內容」。這些區塊只設計**版型**，內容位放「真實素材收集中」占位，並預留「廣告／合作」標示位置。

## 1. 交接方式

- 產出放 repo 的 `design/`（結構見第 3 節）。若你無法直接提交到 GitHub，請匯出檔案，由 Aki 放進同一路徑。
- 每完成一項：更新 `design/STATUS.md`（任務編號、狀態、檔案路徑、需要 Aki 決定的事）。
- 問題寫在 `design/QUESTIONS.md`（標 `[D-xx]`），CODE 會在同檔回覆。CODE 的回饋寫在 `docs/handoff/DESIGN_FEEDBACK.md`。
- 需要 Aki 選版時（三版擇一），在 STATUS.md 標 `⏳ 待 Aki 選版`，CODE 會彙整給 Aki。

## 2. 交付清單（依優先序；前面的會擋住工程）

| 編號 | 交付物 | 格式與路徑 | 擋住誰 |
|---|---|---|---|
| **D-01** | 視覺方向 3 版（以 Aesop 官網為基準，但要有 Dr.Nature 自己的「科學 × 自然」語言）：情緒板、主色、字體配對、攝影調性 → Aki 選 1 版 | `design/brand/directions.md` ＋ `design/brand/directions/*.png` | 全部 |
| **D-02** | Monogram 3 版 → 迭代 → 定稿；含橫式／直式 logotype、單色、反白、favicon 16/32/180/512 | `design/brand/logo/*.svg`（文字外框化、乾淨 viewBox）＋ `favicon/*.png` | 前台、包裝 |
| **D-03** | Design tokens | `design/tokens/tokens.json`，**W3C Design Tokens（DTCG）格式**：color（brand／neutral／semantic／surface，含 light 與 dark）、typography（family、size scale、line-height、letter-spacing、weight）、spacing、radius、shadow、motion（duration、easing）、breakpoint（375／768／1024／1440）、z-index。字體必須註明授權來源（Google Fonts 或已購授權），**中文字體必填**，並註明是否需要子集化 | 前台主題（CODE 會轉成 CSS 變數與 Tailwind 主題，不手抄數值） |
| **D-04** | 元件清單與狀態 | `design/ui/components.md`：每個元件的名稱、變體、狀態（default／hover／focus／active／disabled／loading／error）、RWD 行為；可附 HTML 原型 `design/prototypes/<component>.html`（原型僅供參考，不會直接上線） | 前台元件 |
| **D-05** | 頁面 UX（**手機優先 375px**，再 1440px）：首頁、商品列表、商品頁 PDP、購物車抽屜、結帳三步驟、會員中心（訂單、等級）、Blog 首頁／分類／Pillar／文章頁、分潤夥伴獨立賣場頁、活動 Landing Page 模板、品牌與研發長頁、FAQ、法規頁、404 | `design/ui/pages/<page>.md` ＋ `design/prototypes/<page>.html` | 前台頁面 |
| **D-06** | 動態規格：① 首頁 Hero 品牌影片分鏡（參考「1. 首頁動畫」）② Scroll 互動敘事（參考「2. Scroll up Reference angela」與「2. 互動式網站架構scroll up ref」；工程拆解與限制見 [MOTION_REFERENCES.md](MOTION_REFERENCES.md)）③ 產品動畫（參考「3. 產品動畫」） | ① `design/motion/hero-storyboard.md`（每鏡秒數、畫面、轉場；交付規格：桌機 1920×1080、手機 1080×1350，含首幀 poster）② `design/motion/scroll-scenes.json`（每一幕：`id`、捲動區間 `start%`／`end%`、元素、位移／縮放／透明度關鍵影格、easing）③ `design/motion/product-3d.md`（鏡頭、光線、材質；瓶身是**白色不透明 PE/PP 瓶**，外觀需忠於實品，不可做成透明瓶誤導消費者）。每一段都要附 `prefers-reduced-motion` 的替代呈現 | 前台動態 |
| **D-07** | 包裝：3 款瓶身貼標、3 款外彩盒（套用 `2. 產品瓶器&包裝/Dr.Nature 外彩盒_50x50x100.pdf` 刀模）、品牌小卡 | `design/packaging/label-<sku>.pdf`、`box-<sku>.pdf`（CMYK、出血 3mm、文字轉外框、標註專色）；另交 `label-<sku>-wrap.png`（2048px 寬展開圖，給 3D 材質用）。標示文字區塊用 CODE 提供的 `content/products/<sku>/label.md`，版面要能容納法定標示全部項目 | **印刷前置期最長，請排在 D-02/D-03 之後立刻做** |
| **D-08** | 生成素材美術指導：白底圖、情境圖、模特圖、Landing Page 主視覺的 shot list 與提示詞表；CODE 執行生成後由你選片與指定修圖 | `design/art-direction/shotlist.md`、`prompts.md` | 商品頁、廣告 |
| **D-09** | 信任區塊版型：研發長（真實照片 `5. 品牌素材/研發長_鄭安生博士.avif`）、專利／新聞（僅放查證過的真實報導）、KOL／素人分享（僅版型＋「廣告／合作」標示位） | 併入 D-05 頁面規格 | — |
| **D-10** | 無障礙：文字對比 WCAG AA、可見的 focus 樣式、觸控目標 ≥44px、所有動態的 reduced-motion 版本 | 併入 D-03／D-04 | 驗收 |

## 3. `design/` 目錄結構

```
design/
  STATUS.md            # 進度表（你維護）
  QUESTIONS.md         # 給 CODE 的問題
  UIUX_SPEC.md         # 你的設計規格總覽（只寫設計範圍）
  brand/               # directions、logo、favicon
  tokens/tokens.json   # DTCG 格式，單一真實來源
  ui/                  # components.md、pages/*.md
  prototypes/          # HTML 原型（參考用）
  motion/              # hero-storyboard.md、scroll-scenes.json、product-3d.md
  packaging/           # 貼標、外盒、小卡（印刷檔＋wrap 圖）
  art-direction/       # shotlist、prompts、選片紀錄
```

## 4. 已知的實品規格（不要改，以此設計）

- 瓶身：Yomei PB-100（2-86），100ml 白色 PE/PP 瓶，45.8 × 45.8 × 85.7 mm，三款同規格。來源：`2. 產品瓶器&包裝/產品瓶器規格.pages` → https://www.yomeicorp.com/product?pid_for_show=3818 、`產品瓶器圖.jpg`。貼標可用面積：`TODO(需查證：向瓶器廠確認貼標高度)`。
- 外盒：50 × 50 × 100 mm 天地蓋插舌盒，刀模見 PDF。
- 每瓶 60 顆膠囊，效期 2 年；官網售價 NT$1,150。
- 三款益生菌（第一系列）。**產品名稱尚在法規審查**（「舒敏」「晶亮」等字眼可能被認定暗示醫療效能），包裝與頁面請先用 `SKU-A／SKU-B／SKU-C` 占位，CODE 會在 `content/products/` 定稿後通知。

## 5. 驗收標準（CODE 驗收設計交付時會檢查）

1. tokens.json 能被 Style Dictionary 解析，零錯誤；所有前景／背景配對通過 AA。
2. logo SVG 無點陣圖、無未外框文字，16px 下仍可辨識。
3. 每個頁面規格有 375／1440 兩種寬度，且列出所有元件與狀態。
4. 動態規格每一段都有 reduced-motion 版本與影片檔案大小上限（Hero 首屏影片 ≤ 3 MB 手機版、≤ 6 MB 桌機版）。
5. 包裝檔：出血、CMYK、外框化、法定標示區塊完整。
