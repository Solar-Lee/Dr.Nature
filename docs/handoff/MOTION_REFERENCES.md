# D-06 動態參考：工程拆解與限制（CODE → DESIGN，2026-10-13）

來源：Aki 提供的 `4. Design reference/` 四支參考影片（螢幕錄影，60fps）。本文件只寫**做得出來的方式、檔案預算、法規紅線、無障礙替代**；畫面美學、分鏡、配色由 DESIGN 決定（D-06）。CODE 依 DESIGN 交付的 `design/motion/*` 實作 P7-07／P7-08／P7-09。

## 共通規則（所有動態）

- 每一段都要有 `prefers-reduced-motion` 版本（靜態圖＋淡入即可），且 reduced-motion 時**不下載**影片／序列圖。
- 首屏 LCP 元素必須是 poster 圖（不是影片、不是 3D）；影片與 3D 在 LCP 之後才載入。
- 影片：`muted` `playsinline` 自動播放（iOS 必要條件）；不放音軌。
- 文字一律是 HTML（可被搜尋、可翻譯、可過 claims-lint），**不燒進影片或圖片**。
- 手機（375 寬）先設計；桌機是延伸。

## 1. 首頁 Hero（`compressed_1. 首頁動畫 Hero Section 壓縮.mp4`）

| 看到的 | 做法 | 預算／限制 |
|---|---|---|
| 全幅影片、多個鏡頭輪播（生活情境 → 膠囊微距），左下進度條 | 一支預先剪好的影片＋分段時間碼（進度條由程式依時間碼畫），不做多支影片切換 | 手機 1080×1350 ≤ 3 MB、桌機 1920×1080 ≤ 6 MB（DESIGN_BRIEF 已定）；每鏡附秒數 |
| 標題＋副標＋CTA 疊在影片上 | HTML 疊層；需要對比保護（漸層遮罩）時寫進分鏡 | 文字區不可被影片重點畫面遮住，分鏡需標出安全區 |
| 底部「★★★★★ 12456+ trusted reviews」跑馬燈 | 只能顯示**真實**評論與真實數字（P7-12 機制），上線初期可能沒有 → 版型要能在 0 則時隱藏 | 法規：不得虛構評論 |
| 右下「#1 DOCTOR RECOMMENDED」徽章 | **不可做**：claims.md 第 3 節禁用詞與第 4 節禁止醫事人員背書 | 可替換為可查證的事實（例如檢驗、產地），由 CODE 提供文字 |

## 2. Scroll 敘事 A：Super Matcha（`Adobe Express - 2. Scroll up Reference angela 壓縮.mp4`）

| 看到的 | 做法 | 預算／限制 |
|---|---|---|
| 品牌色滿版底、左側固定選單、超大字標 | CSS `position: sticky`＋字級 token；不需 WebGL | 超大字標用 HTML 文字（中文字體子集化，D-03 註明） |
| 「What's new」橫向卡片輪播 | 原生橫向捲動＋scroll-snap（觸控友善），左右箭頭為輔 | 卡片內容由後台管理（活動／團購），不寫死 |
| Archive 網格＋分類篩選（ALL／LAUNCH…） | 一般列表頁＋篩選；可做成部落格／活動紀錄 | 篩選分類由 DESIGN 定名，CODE 對應到內容模型 |

## 3. Scroll 敘事 B：CropTab（`2. 互動式網站架構scroll up ref.mp4`，DESIGN_BRIEF 原本未列，請一併參考）

| 看到的 | 做法 | 預算／限制 |
|---|---|---|
| 產品隨捲動旋轉、區段釘住（pin） | 我們的 3D 瓶（P7-09，即時 WebGL）＋捲動進度驅動角度；或預渲染序列圖 | 3D 以程式建幾何＋D-07 貼標圖（2048px），總下載 ≤ 1.5 MB；不支援 WebGL 退靜態圖 |
| 產品落水、水花（寫實流體） | **不能即時算**；只能預渲染成「捲動逐格」序列圖（canvas）或全 I 幀影片 | 建議 ≤ 90 格、手機總量 ≤ 2.5 MB（AVIF／WebP），LCP 後才載；捲動逐格影片需每格都是關鍵影格，檔案會大很多 |
| 色塊／馬賽克轉場、遮罩圖片展開 | CSS clip-path／transform，`scroll-scenes.json` 每一幕寫 start%／end%／關鍵影格 | 只用 transform／opacity／clip-path（不觸發版面重排，CLS ≤ 0.1） |
| 橫向跑馬燈標語（For Better Plants…） | HTML 文字＋CSS 動畫 | 標語文案由 CODE 提供並過 claims-lint |
| 數據敘事（Up to 70% of nitrogen is lost） | 版型可參考；**我們的數字必須有出處**（研究／檢驗報告），沒有出處就不用數字 | 法規：不得誇大或涉及醫療宣稱（claims.md） |

## 4. 產品動畫：Ritual（`3. 產品動畫 Product Animation ref 壓縮.mp4`）

| 看到的 | 做法 | 預算／限制 |
|---|---|---|
| 透明瓶身、看得到內容物、金色液體、膠囊微距漂浮 | 預渲染 CGI 影片（非即時 3D） | **與實品衝突**：Dr.Nature 是**白色不透明 PE/PP 瓶**（DESIGN_BRIEF D-06 ③），不可畫成透明瓶。可借鏡的是光線、色調、鏡頭運動與膠囊微距 |
| 膠囊剖面、顆粒漂浮 | 預渲染；內容物外觀須忠於實際劑型（益生菌膠囊／粉末，以 U-08 原料資料為準） | 不可暗示不存在的成分或劑型 |
| 瓶身下方火焰／能量特效 | 純美術選擇，DESIGN 決定 | 避免暗示「燃燒脂肪」等功效聯想（claims.md） |

## DESIGN 交付時請附（讓 CODE 可直接實作、不必回頭問）

1. `scroll-scenes.json` 每一幕：`id`、`start%`／`end%`、元素、transform／opacity／clip-path 關鍵影格、easing、reduced-motion 替代。
2. 需要預渲染的段落（落水、膠囊微距、Hero 影片）：標出**是影片還是序列圖**、格數或秒數、手機與桌機尺寸、首幀 poster。
3. 每段文字的位置與長度上限（中文字數），文案由 CODE 依 claims-lint 撰寫。
