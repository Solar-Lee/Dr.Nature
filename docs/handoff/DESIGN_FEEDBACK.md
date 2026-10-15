# CODE → DESIGN 回饋單

格式：`## [D-xx] 驗收結果（日期）`：✅ 通過／❌ 退回（逐條列出不符合 DESIGN_BRIEF 第 5 節的項目與修正方式）。

## [D-10] CODE 對比與觸控修正紀錄（2026-10-15）

CODE 依 WCAG 2.2（文字 ≥ 4.5:1、大字與非文字元件 ≥ 3:1，不四捨五入）改了下列顏色與尺寸。每一條都寫出舊值、新值、量測結果與**可通過的範圍**：DESIGN 若要重調，只要留在範圍內即可，不必回頭問 CODE；超出範圍的值會讓 `node scripts/contrast-check.mjs apps/storefront/app/globals.css` 變紅（test-all 的 `storefront:contrast`）。所有色值都已收進 `globals.css` 的 `:root` token，DESIGN 交 `design/tokens/tokens.json`（D-03）時請沿用這些角色名稱。

### V-02　06 深色面板、02 深色段落、深色上的 focus 外框

- `.panel-dark` 漸層：舊 `#4a4a48 0% → #8a8a86 55% → #bdbcb8 100%`（白字在 55% 處只有 3.47:1、底端 1.90:1；淺色描邊鈕 `.btn.light` 白框 1.90:1）→ 新 `var(--ink-dark) #1a1a1a 0% → var(--ink-dark-2) #4a4a48 70% → var(--ink-dark-3) #666663 100%`。實測（Playwright 截圖取樣）：描邊鈕旁背景 #4b4b49，白字 8.74:1；kicker 旁 #2c2c2b，#e8e7e2 字 11.29:1；底端 #656562，白字 5.85:1。
- **可通過範圍**：面板上有白字，漸層每一個色標都要 ≤ #767672（白字 4.56:1）；kicker 用 #e8e7e2 時，kicker 所在高度的背景要 ≤ #686868（中性灰，4.50:1）。白色描邊（非文字 3:1）在 ≤ #959591 都過。
- `.dark`（02）與 `.dark .stairs span` 底色改用 `var(--ink-dark)`（值不變，#1a1a1a）。
- `.inline-slot` 描邊：舊 #555（在 #1a1a1a 上 2.33:1）→ 新 `var(--line-dark)` #8a8a86（在 #1a1a1a 上 5.02:1、在自身 #2a2a2a 填色上 4.14:1）。範圍：≥ #666666（對 #1a1a1a 3.03:1）。
- focus 外框：紅色 2px 在深色面板上只有 1.77:1／1.45:1，看不到。新增 `.dark :focus-visible, .panel-dark :focus-visible { outline-color: #fff }`，在所有深色色標上 ≥ 5.76:1。淺底仍是紅框（紙色上 4.40:1，非文字門檻 3:1 通過）。

### A11Y-02　小字紅色改用既有的 `--red-2`（待 DESIGN 確認）

- 品牌紅 `--red` #d7261b 在紙色 #f1f0ec 上只有 4.40:1，12px 以下的紅字不過 4.5:1（axe 在 8 頁共 15 個節點）。
- 改動：`.kicker`、`.hero-meta b`、`.ptag`（字與框）、`.jcard .cat` 改用 token 裡原本就有的 `--red-2` #b81f15（紙色上 5.68:1，hover 底 #f6f5f2 上 5.94:1）。
- 不動：按鈕底色（白字 5.02:1）、wordmark 的點（logotype）、03 tabs 進度線、知識誌 tabs 底線、側欄目前位置方塊、跑馬燈方塊、PDP `.claim` 左線、淺底 focus 外框，都還是 `--red`（非文字 3:1 或大字，全部通過）。
- **可通過範圍**：小字紅在紙色上要 ≥ 4.5:1。例：#d7261b 4.40:1 不過；#d1241a 4.63:1、#c8221a 4.98:1、#b81f15 5.68:1 都過。DESIGN 若想整站只留一個紅，可以把 `--red` 本身改成 #d1241a 或更深（白字按鈕 #d1241a 上 5.29:1、#c8221a 上 5.68:1），屆時 `--red-2` 只剩 hover 用。
- 還剩一處：`app/story/page.tsx:79` 的三支柱編號是 inline `color: var(--red)`（13px，4.40:1），屬 .tsx，由負責 .tsx 的一方改成 `var(--red-2)`；改完 axe color-contrast 全站 0。

### V-04　表單欄位邊界、placeholder、待補標籤虛線、首頁影片說明字

- 新 token `--line-strong` #8a8a86：輸入框邊框（舊 `--line` #cfcdc6，白底上 1.59:1）→ 白底內側 3.47:1、紙色外側 3.04:1、`.soon` #fbfbf9 外側 3.34:1。範圍：邊框對兩側都要 ≥ 3:1；紙色那一側最淡就是 #8a8a86（3.04:1），#8b8b87 已是 2.999:1 不過。
- placeholder：舊 #8a8a86（3.47:1，不過 4.5）→ `--ink-2`（6.71:1）。範圍：白底上 ≤ #767676（4.54:1）。停用中的欄位文字也統一成 `--ink-2`（停用元件本來豁免，只是讓灰階只有一種）。
- 欄位樣式合併成一條 `.input` 規則（`.nl input`、`.soon input` 暫時掛在同一條，等 .tsx 加上 `class="input"` 後拿掉）；`.soon input` 的內距從 10px 12px 統一成 11px 14px。
- PDP 待補標籤 `.pending-list li` 虛線：舊 #9a9a96（紙色上 2.48:1）→ `var(--line-strong)`（3.04:1）。
- 首頁影片佔位說明字 `.hero-video .tag`：拿掉 `opacity: 0.75`（實際只有 3.25:1）→ `--ink-2` 全不透明，在漸層三個色標上 5.42／6.21／4.85:1。若 DESIGN 要它更淡，最淡到 #5f5f5c（在最深的 #dddbd5 上 4.63:1）；#636360 只剩 4.35:1。

### V-13　觸控目標 ≥ 44px（DESIGN_BRIEF D-10）

- 量測（375px，/、/journal/、/products/daily/）：購物車框與「選單」39.4px、03 tabs 34.5px、知識誌 tabs 29.4px、`.textlink` 27.2px、頂欄 wordmark 22px、頁尾連結 20px。改完三頁可見的 a／button／summary 全部 ≥ 44px。
- 外觀不變的部分：購物車框、選單、頂欄 wordmark 只加高度（56px 頂欄置中）；`.textlink` 的 1px 底線改成背景線畫在原位置；03 tabs 文字仍在進度線下 10px，多出的高度在下方；知識誌 tabs 文字仍在底線上 4px，多出的高度在上方（每個 tab 都帶 2px 透明底線，選中才變紅，標籤基線一致）。
- 外觀有變的部分：頁尾連結在 ≤ 1023px 或觸控螢幕上每行 44px（原本約 30px 行距），桌機滑鼠不變。範圍：每個可點目標高度 ≥ 44px；行距可以靠 padding 或 min-height 達成，視覺間距由 DESIGN 決定。
- 截圖（前／後上下對照）：`/private/tmp/claude-501/drn-lane-e/shots/v13-compare-*.png`（暫存，非 repo 檔）。

### V-17　首頁巨型 wordmark 在小手機不再被裁

- 舊 `font-size: clamp(5rem, 19vw, 17rem)`：5rem（80px）下限讓 wordmark 在 320px 寬約 329px（WebKit 337px），超出 288px 內容寬被 `.hero` 的 overflow 裁掉。新下限 3.75rem：320px 時 60.8px、375px 時 71.25px，Chromium／WebKit 在 320–414px 全部放得下。
- 外觀變化：375–420px 的手機上 wordmark 從固定 80px 變成跟著 19vw（71–80px）。若 DESIGN 想在 375px 維持接近 80px，可改用只在 ≤ 420px 生效的 `min(5rem, 21vw)`（以目前字型寬約 4.21em 計，320px 起都放得下）；換成自架字型（VI-05）後要重量。

### VI-07　02 段落的「暗字」在減少動態或沒有動畫時不再像停用

- 02 標題後半句 `.dim` 的靜止色：舊 #6f6f6b（在 #1a1a1a 上 3.45:1，看起來像停用文字）→ 新 token `--ink-dim` #8a8a86（5.02:1）。範圍：在 #1a1a1a 上 ≥ 4.5:1，中性灰最暗到 #828282（4.53:1；#7f7f7c 只有 4.33:1）；要保留「先暗後亮」的對比感，可在 #828282–#9a9a96（6.16:1）之間調。
- 系統設定「減少動態」時，沒有任何機制會把暗字點亮（不跑 GSAP，標題也沒有 scroll reveal），所以直接顯示為亮字 `--paper`、不做轉場。
- 有動畫時（`.fx`）不變：仍然由暗轉亮。沒有 JavaScript 或 GSAP 載入失敗時停在 `--ink-dim`。

### V-11　`globals.css` 的色值全部收進 token（D-03 對照用）

`:root` 之外已沒有任何 hex 色值。新增的角色 token（值不變，除了瓶子插圖）：`--surface` #ffffff（欄位、卡片舞台亮心）、`--surface-2` #fbfbf9（規格表、研發長名片、即將開放面板）、`--hover` #f6f5f2（卡片 hover）、`--stage-hi` #f9f8f5（03 舞台光暈）、`--video-hi` #f7f6f3／`--video-lo` #dddbd5（首頁影片佔位漸層）、`--on-dark` #ffffff（深色面與紅底上的字、框、focus 外框）、`--slot-dark` #2a2a2a、`--hair-dark` #333333（02 底線，裝飾）、`--bottle-edge` #d8d7d1。瓶子示意圖（D-07 會取代）的 9 個陰影色併成 `--surface`／`--bottle`／`--bottle-shade`／`--bottle-edge` 四個，像素差最多 10/255，只在卡片瓶身範圍。D-03 的 `tokens.json` 請沿用這些角色名，CODE 再轉回 CSS 變數。


## [D-11] 2026-10-15 七條實作車道給 DESIGN 的回饋彙整（CODE 整理）

> 來源：各車道的 design_feedback 欄位；車道 E 的對比度／觸控紀錄已在 [D-10]。每條都是 CODE 為了正確性或無障礙先做的暫行選擇，DESIGN 可在通過範圍內重調。

- 車道 C：Home section 02 now reads 「Dr.Nature 說的每一句話，／都照一本筆記的〔inline slot〕規矩寫。」. At 390px the b2 part wraps to 「規矩」 + 「寫。」 on the next line (Playwright shot). DESIGN may want to resize the inline slot or the type at phone width. The text cannot change: it is story.md:148 verbatim.
- 車道 C：The /story/ dark opener band now holds the main slogan 「少說一點，／說準一點。」 (slogan.md:52 brand page). Before, it repeated HOME.s02, which would now duplicate the h1 directly below it.
- 車道 C：Note for design/QUESTIONS.md (CC-05 step 2, not written because design/ is not a lane-C file): D-E03 情境影像須依 content/brand/story.md:333 — 不拍浴室或潮濕場景，不拍孩童伸手可及的擺放；首頁 05 四格標籤已改為時段（早晨／午後／傍晚／夜裡），不是擺放位置。
- 車道 G：Rich menu image (content/line/rich-menu.md section 2): 2500x1686 px in 3 columns by 2 rows, with pixel bounds given in section 1. Tile text: 產品／先讀標籤，再決定。, 知識誌, 常見問題, 會員綁定（即將開放）, 真人客服, 小測驗（讀標籤 5 題）. Deliver it to design/line-oa/richmenu-main.png. LINE's image format, size and file-size limits are TODO(需查證); the only example in the docs is image/png.
- 車道 G：Rich menu must not show: the R&D director's name or photo; the main slogan next to the director; any function sentence; white coat, stethoscope, prescription, test tube or measuring cylinder imagery; exclamation marks or countdowns; bathroom scenes or within-reach placement (slogan.md:64-68, story.md:206,212,215,231).
- 車道 G：OA avatar: the brand Monogram is preferred. If the director's photo is used, it must not show a white coat (claims.md:30).
- 車道 D：A11Y-05 pause switch placement (needs DESIGN sign-off): footer first column, directly under the wordmark, on every page and width. Outline button 「暫停動態」, 13px/700, 44px min height, 1px ink border, radius 0; pressed state (aria-pressed=true) is inverted ink background with paper text. Label stays constant (toggle pattern). Alternatives if DESIGN prefers: next to the marquee itself on / (right gutter) plus the footer copy, or the side-nav foot next to the cart box on desktop. Screenshot: /private/tmp/claude-501/drn-lane-d/footer-motion-1280.png.
- 車道 D：Weight 500: PERF-02 was not shipped, so nothing changed. If the self-hosted font is approved as the 'variable' face, weight 500 (sidenav links, menu sub links) keeps rendering as true 500; if DESIGN prefers the audit's two static weights 400/700 instead, CSS font matching maps 500 to 400 (no byte saving, see PERF-02 skip reason).
- 車道 D：Breadcrumb (UX-13) sits at the top of .pdp-info: on desktop it heads the right column; below 1024px it appears after the 3D stage, not at the top of the page. DESIGN to decide whether it should move above the stage on phones.
- 車道 D：Footer now has five columns (wordmark+pause, 產品, 關於, 服務, 社群); .sitemap is still a four-column grid at >= 760px, so 社群 wraps to a second row until lane E updates the grid (screenshot /private/tmp/claude-501/drn-lane-d/footer-1280.png). Legal row markup: .legal > .disclaimer-row (two <p>) + © span + company span; the two-column grid is lane E's V-16 CSS.
- 車道 D：Pre-existing: the mobile menu panel is position:fixed with inset 56px 0 0 0, but while the 30px preview notice is on screen the top bar sits lower, so the panel covers the lower half of the 選單 summary (screenshot /private/tmp/claude-501/drn-lane-d/menu-390.png). Escape and link taps still close it.
- 車道 D：Lane D appended CSS (block 'a11y utilities (lane D)' at the end of globals.css) includes look-preserving shims DESIGN/lane E may fold into the main sheet: .sitemap .foot-head (copy of the old .sitemap h4), .pcard h2 (copy of .pcard h3), .menu-story-head, .crumbs, .foot-motion, .motion-toggle, .faq details[id] scroll-margin-top 72px.
- 車道 B：MO-10 (DESIGN gate): on the home page the side-index story links now jump instantly in every engine (html:not(.fx) keeps smooth elsewhere). If the glide through the story should stay, the Nav owner can call element.scrollIntoView({ behavior: 'smooth' }) for the story links; html:focus-within was rejected because Safari/iOS do not focus links on click (Chrome would glide, iPhone would jump).
- 車道 B：V-18: the hero bottle now leans 8 deg (three.js tilt 0.14 rad only) instead of the 16 deg it showed (CSS -8 deg + 3D 8 deg); the 04 contact shadow now lies flat under the tilted bottle instead of tilting with it. Screenshots: /private/tmp/claude-501/drn-lane-b/dbg/before-hero.png, before-s04.png, after-hero.png, after-s04.png. If 16 deg was intended, change the tilt prop, not the CSS.
- 車道 B：MO-12: the hero is now held by CSS sticky for exactly its own height (same distance as the old pin, verified hero top 0 at y=300/600 and -100 at y=900 on 1280x800); please confirm on a real iPhone that 02 still slides over it as in the prototype.
- 車道 B：M3D-04: the phone hero is taller than one screen at 375x812 and on iPhone 14 (390x664), so the bottom-anchored giant wordmark starts below the first screen; deciding whether the phone hero should shrink (stage height, copy/meta stacking) is a DESIGN/visual-lane call.
