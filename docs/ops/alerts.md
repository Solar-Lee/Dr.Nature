# Runbook：告警與處置（Mac mini）

來源：`infra/host/drn-monitor.sh`（每 300 秒）、`drn-backup.sh`、`drn-restore-check.sh`、`drn-compose-up.sh`；外部 UptimeRobot 與 Cloudflare Tunnel 通知。每個 `/fail` 都帶代號；Healthchecks 的檢查：`drn-heartbeat`、`drn-ecpay-alert`、`drn-access`、`drn-backup`、`drn-restore-check`。

| 代號 | 意義 | 處置 |
|---|---|---|
| （heartbeat 完全沒 ping） | Mac 停機、睡眠、停在 FileVault 畫面、Aki 登出、Docker Desktop 沒起來 | 到主控台解鎖／登入；確認 Docker Desktop 在跑；`launchctl print gui/$(id -u)/drn.monitor` |
| `maintenance-overdue:<理由>` | 維護旗標超過到期時間 | 查 `~/drn/logs/maint.log`；完成後 `drn-maint end` |
| `docker-api` | Docker Desktop 引擎不可用 | 啟動 Docker Desktop；`drn-docker info` |
| `containers:<名單>` | 核心容器不在跑或不健康（monitor 已自動補啟一次，30 分鐘冷卻） | `drn-docker logs --since 30m <容器>`；`drn-compose up -d --wait` |
| `restarts:<容器>` | 重啟次數增加或 OOMKilled（黏住 60 分鐘） | 看日誌；反覆 OOM 時提高 Docker Desktop 記憶體或該容器 `mem_limit` |
| `pg`／`redis`／`redis-aof` | pg_isready 失敗／PING 失敗／AOF 最後寫入失敗 | 看容器日誌與磁碟；AOF 失敗多半是磁碟滿 |
| `local-health` | `127.0.0.1:3961/health` 不是 OK | `drn-docker logs drn-backend` |
| `disk-host:<n>%`／`disk-postgres:<n>%` | 主機剩餘 < 10%／資料卷使用 ≥ 85% | 清理備份以外的東西；**不做任何 prune**（CLAUDE.md） |
| `backup-age:<n>h` | 最新 daily 超過 26 小時 | `launchctl print gui/$(id -u)/drn.backup`；手動 `drn-backup.sh daily` |
| `simpay-unexpected`／`simpay-too-long`／`simpay-unknown` | 模擬付款旗標開著但沒有標記／標記超過 4 小時／狀態無法判斷 | `drn-drill.sh simpay status`；演練結束後 `drn-drill.sh simpay off` |
| `jobs` | worker 最近 21 分鐘沒有 `[JOB-HEARTBEAT]`（啟動未滿 21 分鐘不判） | `drn-docker logs --since 30m drn-worker`；重建 worker：`drn-compose up -d --force-recreate drn-worker` |
| `mem-pressure` | 記憶體壓力連續兩次為 4（黏住 60 分鐘） | 關掉主機上其他大程式；調整 Docker Desktop 記憶體 |
| `isolation` | 容器可連到的主機埠數超過基準（`state/monitor/probe-baseline`） | 立刻 `drn-compose stop drn-cloudflared`；`drn-probe.sh --network drn_net`；查主機新開的服務 |
| `ALERT xN ERRORS xM`（drn-ecpay-alert） | `[ECPAY-ALERT]`／`[PROMO-ALERT]`／`[EMAIL-ALERT]`／`[MEMBERSHIP-ALERT]` 待處理，或錯誤行 ≥ 5 | 看 `~/drn/logs/alerts-YYYYMM.log`，依 [ecpay-manual-refund.md](ecpay-manual-refund.md)／[ecpay-logistics-c2c.md](ecpay-logistics-c2c.md) 處理；處理完 `drn-maint ack alerts`（不 ack 不會自己消失） |
| `access-drift:<code>`／`access-drift:no-baseline` | `/admin/users/me` 的狀態碼、Location 主機或 cf-mitigated 與基準不同 | 立刻 `drn-compose stop drn-cloudflared`；檢查 Access 應用與 Bot Fight Mode；修好後 `drn-monitor.sh --record-access-baseline` |
| `compose-up:maintenance`／`:docker`／`:up`／`:health` | 登入後啟動被維護旗標擋下／Docker API 300 秒內不可用／up 失敗／本機 health 失敗 | 依代號處理；`~/drn/logs/compose-up.log` |
| `drn-backup` 的 `line=… exit=…` | 備份腳本在該行失敗 | `~/drn/logs/backup.log`；常見：容器不在、toc 低於 90%、異地上傳失敗 |
| `drn-restore-check` fail `<detail>` | 還原演練失敗（錨點不符、pg_restore 失敗、上傳檔壞） | `~/drn/logs/restore-drills.log` 最後一行；用前一份 dump 再試 |
| UptimeRobot down | 公開 `/health` 不通（DNS、Tunnel、Access 誤擋） | `drn-docker logs drn-cloudflared`；Cloudflare Tunnel 頁面 |
| Cloudflare Tunnel Health／Creation／Deletion | Tunnel 斷線或被建立／刪除 | 斷線：看 cloudflared 日誌；非預期的建立／刪除：Rotate token、檢查帳號成員 |

狀態規則：事件類（restarts、mem、isolation）保留 60 分鐘；ALERT 保留到 ack；access 每小時才更新。維護旗標只壓住 heartbeat 的容器檢查，ALERT 掃描照常。

演練（P12-20 的驗收）：(a) 不設旗標 `drn-docker stop drn-worker` → 下一輪 `containers:drn-worker` 且 monitor.log 有 auto-up；(b) `medusa exec ./src/scripts/ecpay-public-drill.js alert-selftest` → `ALERT x1`，ack 後才恢復；(c) `drn-monitor.sh --access-only --access-path /health` → `access-drift:200`；(d) `drn-maint quiet edge-drill 30` 後 `drn-compose stop drn-cloudflared` → UptimeRobot 與 Tunnel Health 報 Down，`drn-maint end` 後恢復。每一項都要 Aki 確認手機真的收到。
