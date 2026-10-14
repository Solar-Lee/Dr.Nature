# Runbook：備份與還原（Mac mini）

腳本：`infra/host/drn-backup.sh`、`infra/host/drn-restore-check.sh`（P12-08、P12-21）。法規依據見 [research/mac-mini-deploy-2026-10-13.md](../research/mac-mini-deploy-2026-10-13.md)「備份、告警與法規」：數位經濟相關產業個人資料檔案安全維護管理辦法第 11 條（備份要有保護措施，必要時加密）、第 16 條（紀錄至少保存 5 年）。

## 排程與內容

| 工作 | 時間（本地） | 內容 | Healthchecks |
|---|---|---|---|
| `drn.backup` | 每天 04:15 | `drn-backup.sh daily`：`pg_dump -Fc`（在 `drn-postgres` 內）、`pg_dumpall --globals-only --no-role-passwords`、上傳檔 tar.gz（一次性容器、`--network none`、資料卷唯讀）、manifest（toc、sha256、備份前後錨點、指紋） | `/start` → 成功 `toc=N sha=<12> offsite=ok\|unset`；失敗 `/fail line=… exit=…` |
| `drn.restore-check` | 週日 05:00 | `drn-restore-check.sh`：最新 daily dump 還原到同 digest 的一次性 Postgres（`--network none`、1 GiB），比對錨點 | pass／fail |
| 手動 `pre` | 升級前（寫入者已停） | 只有 DB＋globals；sha256 與指紋寫進 `releases.log` | 無 |
| 手動 `pre-rollback` | 破壞性還原前 | 同上；永不自動刪除 | 無 |

驗證規則：`pg_restore --list` 條目數 ≥ 上一份的 90%（第一份只要 > 0）；上傳檔 `gzip -t`；任何 `docker exec` 離場碼非 0 即失敗。保留：daily 14、weekly 8（週日另存）、pre 3。

還原演練的錨點（不能是空集合也通過）：product 數、public 表數、已完成 drn-* 腳本數必須等於 manifest；order／customer／payment 筆數落在備份前後之間；`script_migrations` 未完成數 0；上傳檔數 ≥ manifest。每次一行 JSON 寫進 `~/drn/logs/restore-drills.log`（保存 5 年）。

2026-10-14 演練（改名的 `drn-rh-*` 堆疊、真實 pg_dump／pg_restore）：daily 備份 toc=1075，還原演練 `pass`，錨點 product=3 tables=153 drn=7。

## 異地與離線

- `~/drn/age-recipients.txt` 有公鑰、`host.env` 有 `DRN_R2_REMOTE` 時，每份 daily 都用 `age -R` 加密後 `rclone copyto` 到 R2，並用 `rclone lsjson` 比對大小。R2 驗證通過後 `touch ~/drn/state/offsite-required`，之後異地失敗或未設定一律算備份失敗。
- 私鑰兩份離線保存（USB＋密碼管理器）；每月由 Aki 複製一份 `.age` 到 USB；不用 iCloud Drive。
- 每季 Aki 做一次解密演練：`rclone copyto drnr2:drn-backups/weekly/<檔> ./x.age && age -d -i /Volumes/<USB>/drn-backup-identity.txt -o x.dump x.age && bash ~/drn/bin/drn-restore-check.sh ./x.dump`，然後刪掉明文。
- 境外加密備份是否屬個資國際傳輸而需揭露：D21，由 Aki 或法律顧問確認。

## 在正式庫還原（只在回滾或災難時，每次都要 Aki 當下核准）

用 `drn-rollback.sh <舊sha> --restore <pre dump>`（[deploy-backend.md](deploy-backend.md) §4）。災難時沒有 pre dump：先 `drn-maint stop`，再把最新 daily 解密後照 §5「整機重建」的順序做。

## 不備份的東西

`.env`、`tunnel.env`、`host.env`、`rclone.conf`、age 私鑰（災難時：重新產生 `.env`、到 Cloudflare Rotate token、重建 R2 權杖）。Redis 只開 AOF，不另外備份（遺失時丟掉未處理事件與 Admin session）。

## Time Machine

目前沒有設定目的地。日後開啟前先 `tmutil addexclusion ~/drn/backups`（G-PII 閘門項目）。
