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
