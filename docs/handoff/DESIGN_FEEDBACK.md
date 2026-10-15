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
