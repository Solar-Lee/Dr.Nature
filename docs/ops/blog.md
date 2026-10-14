# Blog：資料模型、API、後台編輯與發佈規則（P6-01、P6-02）

適用：內容編輯（`content_editor`）與 Super Admin；前台（P6-03／P7）讀取 Store API。程式：`apps/backend/src/modules/blog`（模組）、`src/lib/blog/`（規則）、`src/api/admin/blog/**`、`src/api/store/blog/**`；測試：`integration-tests/http/blog.spec.ts`、`src/lib/blog/__tests__/`。

## 1. 資料

| 實體 | 欄位 |
|---|---|
| 文章 `blog_post` | `title`、`slug`（唯一，小寫英數與單一連字號，例如 `gut-basics`）、`type`（`pillar`／`cluster`）、`pillar_id`（cluster 必填、指向一篇 pillar；pillar 一律為空）、`excerpt`、`body_markdown`、`status`（`draft`／`published`）、`published_at`、`author_name`、SEO：`meta_title`、`meta_description`、`canonical_url`、`og_image_url`（http／https）、`noindex`；`created_at`／`updated_at` 自動 |
| 分類 `blog_category`、標籤 `blog_tag` | `name`、`slug`（唯一）；與文章多對多 |

可見性：`status = published` 且 `published_at <= 現在` 才會出現在 Store API。`published` 但 `published_at` 在未來＝**排程**（後台顯示 `visibility: "scheduled"`）。發佈時沒填 `published_at` 就以當下時間為準。

## 2. 系統會擋的事

| 情況 | 結果 |
|---|---|
| cluster 沒有 pillar、指向不存在的文章、指向另一篇 cluster 或自己 | 400 |
| pillar 帶 `pillar_id` | 400（cluster 改成 pillar 時自動清空） |
| 還掛著 cluster 的 pillar 要刪除或改成 cluster | 400，先把 cluster 改掛到別的 pillar |
| slug 重複（文章、分類、標籤各自唯一） | 400 |
| **發佈時**（或修改已發佈的文章時）`title`、`excerpt`、`body_markdown`、`meta_title`、`meta_description` 含 [claims.json](../compliance/claims.json) 的禁用詞（`error` 等級） | 400，`code: "BLOG_BANNED_TERMS"`，`terms` 列出所有禁用詞、`hits` 標出欄位與行列。草稿可以先存；`warn` 等級只提醒不擋。允許的聲明句（`disclaimer_allowlist`）整句不算 |
| 分類、標籤名稱含禁用詞 | 400（名稱會公開在 Store API） |

後端用的規則是 `apps/backend/src/data/claims.json`，與 `docs/compliance/claims.json` 相同（`node scripts/sync-catalog.mjs` 複製；`--check` 不同就失敗）。比對方式與 `scripts/claims-lint.mjs` 相同（單元測試逐字比對兩者結果）。

## 3. API

Admin（需登入；權限見 §4）：

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET／POST | `/admin/blog/posts` | 列表（`q`、`status`、`type`、`pillar_id`、`limit`、`offset`；依更新時間新到舊）／新增（201） |
| GET／POST／DELETE | `/admin/blog/posts/:id` | 單篇（含 `pillar`、`clusters`、`visibility`）／部分更新（未帶的欄位不變，`null` 清空，`category_ids`、`tag_ids` 整組取代）／刪除 |
| GET／POST | `/admin/blog/categories`、`/admin/blog/tags` | 列表（`q`、`limit`、`offset`）／新增 `{ name, slug }` |
| GET／POST／DELETE | `/admin/blog/categories/:id`、`/admin/blog/tags/:id` | 單筆／更新／刪除（與文章的關聯一起移除） |

Store（需 publishable key，與其他 `/store` 路由相同）：

| 路徑 | 回傳 |
|---|---|
| `GET /store/blog/posts?limit=&offset=&category=<slug>&tag=<slug>&type=pillar\|cluster` | `{ posts, count, limit, offset }`，依 `published_at` 新到舊；`limit` 1–100（預設 20）；不含內文 |
| `GET /store/blog/posts/:slug` | `{ post }`，含 `body_markdown`；cluster 帶 `pillar`（pillar 不可見時為 `null`），pillar 帶可見的 `clusters`（新到舊）；草稿、排程、不存在都回 404 |
| `GET /store/blog/categories` | `{ categories }`（依名稱） |

`body_markdown` 是原始 Markdown；前台渲染時**不得執行其中的 HTML**（P6-03）。

## 4. 後台編輯介面（P6-02）

後台左側選單「Blog」（`/app/blog`，程式 `apps/backend/src/admin/routes/blog/**`）：

- 列表：搜尋標題／slug、依狀態篩選（草稿／已發佈與排程）、分頁；狀態標籤「草稿」「排程」「已發佈」。下方列出分類與標籤（可刪除）。
- 新增／編輯：標題、slug、類型、所屬 pillar（只列出 pillar）、狀態、發佈時間、作者、摘要、分類與標籤（可直接新增）、SEO 欄位、noindex；內文是 Markdown，右側即時預覽。pillar 的編輯頁會列出掛在它下面的 cluster；最下方可刪除文章。
- **排程**：狀態選「發佈」並填未來的發佈時間（以瀏覽器所在時區輸入），到時間才會出現在前台。發佈時間留空＝按下儲存時立即發佈。已發佈的文章再次儲存時，如果沒改發佈時間，原本的時間不變。
- **預覽不會執行 HTML**：內文裡的 HTML（例如 `<script>`）只會以文字顯示；連結與圖片只接受 `https://`、`http://`、站內 `/…` 與 `#…`。預覽只支援常用語法（標題、粗體、斜體、清單、引言、程式碼、分隔線、連結、圖片），與前台最終樣式可能不同（前台 P6-03 決定渲染方式）。沒有新增任何套件（lockfile 內沒有 Markdown 套件，預覽是 `src/admin/lib/markdown.ts` 自寫的小型解析器）。
- 含禁用詞時，畫面列出每個字詞、所在欄位、行與字的位置及理由；可以先存成草稿再修改。

## 5. 權限

RBAC 資源 `blog_post`、`blog_category`、`blog_tag`（各有 read／create／update／delete；`src/policies/blog.ts`）。`content_editor` 全部都有（新資料庫由 drn-0004 建立；P6 以前建立的角色由 drn-0008 補上），Super Admin（`*:*`）也可以；營運、客服、財務與沒有角色的帳號一律 403（每個路由在 `src/api/middlewares.ts` 宣告）。

## 6. 回滾

1. 後台介面：刪除 `src/admin/routes/blog`（以及 `src/admin/components/blog-*`、`src/admin/lib/blog-api.ts`、`markdown*.ts`）後重新 build。
2. 從 `medusa-config.ts` 移除 `./src/modules/blog`、刪除 `src/api/{admin,store}/blog`、`src/policies/blog.ts`。
3. 資料表：`medusa db:rollback blog`（2026-10-14 在拋棄式資料庫 `drn_blog_gen` 驗證：還原後 `blog_*` 資料表全數移除，再 `db:migrate` 可重建）。**正式環境先 `pg_dump` 備份**（`docs/ops/backup-restore.md`）。
4. drn-0008 已執行的資料庫：角色上的 `blog_*` 權限在 policy 不再註冊後會被 Medusa 同步為刪除狀態，不需另外處理。
