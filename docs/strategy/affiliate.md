# 分潤賣場（P9）

> 版本 v1，2026-10-14，CODE。程式：`apps/backend/src/modules/affiliate/`、`apps/backend/src/lib/affiliate/`、`apps/backend/src/subscribers/affiliate-attribution.ts`；測試：`integration-tests/http/affiliate.spec.ts`、`src/lib/affiliate/__tests__/`。
> **狀態：系統行為已實作；標「提案」的規則待 Aki 核准。** 本文是規則與口徑，不寫任何市場數字或功效說法。上游：[go-to-market.md](go-to-market.md) §1（團主碼與歸因）、DEV_PLAN §4（tuangou-admin 對接）。

## 1. 名詞

| 名詞 | 意思 |
|---|---|
| 夥伴（partner） | 團主／KOL。`tuangou_kol_id` 是 tuangou-admin 的 KOL 代號（GMV 匯出的 `kol` 欄，P9-03），不可重複；`ig_handle` 只存帳號名稱 |
| 賣場（store） | 夥伴在某段期間的選品頁，前台網址 `/s/<slug>`，只在團購前台（Group-buy 通路的 publishable key）出現 |
| 歸因（attribution） | 這張購物車／訂單算哪一個賣場、哪一位夥伴的 |

## 2. 賣場什麼時候算「開放中」

同時滿足才開放：狀態 `active`、夥伴狀態 `active`、現在時間在 `starts_at`（含）到 `ends_at`（不含）之間。草稿（`draft`）、已結束（`ended`）、還沒開始、已過期、夥伴停用，前台一律回 404「找不到這個賣場，或賣場活動已結束。」，不說明原因。

為了保住歷史紀錄（已成立訂單的歸屬）：
- 夥伴建立賣場後不能更換；有賣場的夥伴不能刪除，只能停用（停用會同時關閉他所有賣場）。
- slug 只在草稿狀態可以改（連結發出去之後就不能改）；只有草稿可以刪除，開過的賣場改成 `ended`。
- 後台權限：營運（operations）與 Super Admin 可新增、修改、刪除；財務（finance）只能查看（沿用 `promotion:*` 權限，見 `src/api/middlewares.ts`）。

## 3. 歸因規則

1. **寫入：** 前台在團購購物車呼叫 `POST /store/carts/:id/affiliate { slug }`。賣場必須開放中；寫入 `cart.metadata.affiliate = { store_id, partner_id, slug, attributed_at }`。官網購物車或官網 key 一律拒絕（400）。
2. **最後點擊為準（提案）：** 同一張購物車換到另一個賣場，以最後一個為準；一張訂單只歸一位夥伴（go-to-market §1 第 3 點）。
3. **移除：** `DELETE /store/carts/:id/affiliate`。
4. **不能偽造：** Medusa 2.21.2 的一般購物車路由（`POST /store/carts`、`POST /store/carts/:id`）允許顧客寫任何 metadata，而且結帳時會整包複製到訂單。所以這兩條路由拒絕 `affiliate`、`affiliate_*` 這些鍵，也拒絕 `metadata: null` 或 `{}`（會把整包 metadata 換掉、等於刪掉歸因）；要刪掉自己的某個鍵，請送該鍵為空字串 `""`。
5. **成立訂單時再確認一次：** 購物車成為訂單時（以訂單 `created_at` 為準），系統確認賣場還存在、夥伴與 slug 一致、而且當時仍開放。
   - 通過：`order.metadata.affiliate` 保留，加上 `verified_at`。
   - 不通過：**訂單照常成立**，歸因移到 `order.metadata.affiliate_dropped`（含原因 `reason`：`ended`、`expired`、`draft`、`not_started`、`partner_inactive`、`store_missing`、`store_mismatch`、`malformed`，與 `dropped_at`），不計入任何夥伴。
   - 為什麼不在結帳當下擋：Medusa 2.21.2 在結帳時先讀購物車、再呼叫唯一的檢查點（validate hook），之後用先前讀到的資料建立訂單，檢查點改不了訂單內容；而且綠界已開出繳費代碼或已收款的購物車也必須能成立訂單。所以由 `order.placed` 事件處理（`src/subscribers/affiliate-attribution.ts`）。
   - 已知限制：期間（`starts_at`／`ends_at`）用訂單成立時間精準判斷；賣場與夥伴的「狀態」是事件處理當下讀的，正常情況在成立後數秒內。若處理失敗，系統記錄 `[AFFILIATE-ALERT]`，P9-03 的 GMV 匯出會再檢查一次期間與賣場一致性。

## 4. 前台 cookie 契約（P9-04 實作，提案）

後端不讀 cookie。前台負責記住顧客從哪個賣場進來：

| 項目 | 規則 |
|---|---|
| 名稱 | `drn_aff` |
| 值 | 賣場 slug（只放 slug，不放夥伴資料或個資） |
| 期限 | 30 天（`Max-Age=2592000`），第一方 cookie |
| 屬性 | `Path=/`、`SameSite=Lax`、`Secure`、`HttpOnly`（前台伺服器端讀取，瀏覽器腳本不需要讀） |
| 設定時機 | 顧客打開 `/s/<slug>`，且 `GET /store/affiliate/stores/:slug` 回 200；新的賣場覆蓋舊的（最後點擊） |
| 使用時機 | 團購前台建立或取回購物車時，cookie 有值就呼叫 `POST /store/carts/:id/affiliate` |
| 清除時機 | 上一步回 404（賣場已結束）時，前台刪除 cookie，不再重試 |
| 告知 | 隱私權政策要說明這個 cookie 的用途（歸因給推薦的夥伴）與期限；文案由 CODE 寫、Aki 核准 |

賣場歸因只靠這個流程，後端不看 UTM；UTM 仍照 go-to-market §1 第 2 點保留給廣告分析。P5-05 的團主碼（`kol_code`）照舊用代碼本身歸因，不經過賣場。
