# Blog：資料模型、API 與發佈規則（P6-01）

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

## 4. 權限

RBAC 資源 `blog_post`、`blog_category`、`blog_tag`（各有 read／create／update／delete；`src/policies/blog.ts`）。`content_editor` 全部都有（新資料庫由 drn-0004 建立；P6 以前建立的角色由 drn-0008 補上），Super Admin（`*:*`）也可以；營運、客服、財務與沒有角色的帳號一律 403（每個路由在 `src/api/middlewares.ts` 宣告）。

## 5. 回滾

1. 從 `medusa-config.ts` 移除 `./src/modules/blog`、刪除 `src/api/{admin,store}/blog`、`src/policies/blog.ts`。
2. 資料表：`medusa db:rollback blog`（2026-10-14 在拋棄式資料庫 `drn_blog_gen` 驗證：還原後 `blog_*` 資料表全數移除，再 `db:migrate` 可重建）。**正式環境先 `pg_dump` 備份**（`docs/ops/backup-restore.md`）。
3. drn-0008 已執行的資料庫：角色上的 `blog_*` 權限在 policy 不再註冊後會被 Medusa 同步為刪除狀態，不需另外處理。
