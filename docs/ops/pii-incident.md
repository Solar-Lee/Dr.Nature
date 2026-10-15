# Runbook：個資事故（草案，待 D21 法務確認）

依據：[research/mac-mini-deploy-2026-10-13.md](../research/mac-mini-deploy-2026-10-13.md)「備份、告警與法規」——數位經濟相關產業個人資料檔案安全維護管理辦法（數位發展部，適用網路零售業 4871）：第 8 條，危及正常營運或大量當事人權益的事故要在**知悉後 72 小時內**依附表二通報；第 16 條，紀錄至少保存 5 年；個資法第 12 條，查明後以適當方式通知當事人（114 年修正條文的通報義務施行日期未定）。本檔不是法律意見。

## 沙箱期間（U-02 之前）

資料庫只有測試訂單與演練資料，沒有真實個資。發生可疑存取時：`drn-compose stop drn-cloudflared`，保留日誌（`~/drn/logs/`、`drn-docker logs`），回報 Aki。

## 收真實訂單之後

1. **止血**（CODE，立刻）：`rm ~/drn/state/edge-enabled && ~/drn/bin/drn-compose stop drn-cloudflared`；必要時 `drn-maint stop incident`。到 Cloudflare Rotate tunnel token；如懷疑金鑰外流，Aki 輪替 `.env` 的 JWT／COOKIE 密鑰與綠界金鑰。
2. **保全證據**：複製 `~/drn/logs/`、`docker logs` 輸出與 Cloudflare Security Events 到離線位置；不要 prune、不要重建容器。
3. **評估範圍**（Aki＋CODE）：哪些表、幾筆、什麼欄位（order／customer／address／payment_session）；用當日備份與 `drn_fingerprint` 比對。
4. **通報**：達到第 8 條門檻時，Aki 在知悉後 72 小時內依附表二格式通報數位發展部；依個資法第 12 條通知當事人（Email／簡訊）。範本與判斷門檻：D21 由法律顧問確認。
5. **紀錄**：事故經過、處置、通知時間寫進 `~/drn/logs/incidents.log`（保存 5 年）。
6. **復原**：修補後重新 `drn-probe`、`drn-monitor.sh --record-access-baseline`，再啟用 edge。

## 預防（G-PII 閘門，P12-25）

獨立使用者或專用主機、管理員 MFA、源站驗證 Access JWT、Redis requirepass、R2 離線演練、UPS、Time Machine 排除、D24 的主機服務加固。
