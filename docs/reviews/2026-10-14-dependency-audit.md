# 相依套件稽核（P11-06 的一部分，2026-10-14）

指令：`pnpm audit --prod --json`（repo 根目錄，鎖定檔 2026-10-14 版本）。結果：critical 0、high 3、moderate 6、low 0。九條全部經由 `@medusajs/*` 2.21.2 的相依鏈進來，沒有任何一條是本專案直接相依的套件。

| 嚴重度 | 套件（已裝版本） | 進來的路徑（節錄） | 同主版本內的修正版 | 處置 |
|---|---|---|---|---|
| high | lodash 4.17.23（`_.template` 程式碼注入） | @medusajs/utils › @graphql-codegen/plugin-helpers | 4.18.1（`npm view lodash version`，4.18.0 發佈於 2026-03-31） | 以 pnpm override 升到 4.18.x（另開提交，跑完整 test-all＋重建映像） |
| moderate | lodash 4.17.23（`_.unset` 原型污染） | 同上 | 同上 | 同上 |
| moderate | ajv 8.13.0（`$data` ReDoS） | @mikro-orm/migrations › umzug › @rushstack/* | 8.20.0（8.18.0 發佈於 2026-02-14） | 以 override 升到 8.18 以上 |
| high | braces 3.0.3（深層巢狀 DoS） | @mikro-orm/core › globby › micromatch | 無（patched `<0.0.0`） | 只在 CLI／遷移時對**專案自己的檔案路徑**展開，不接受外部輸入；記錄為已知風險 |
| high | @graphql-tools/utils 10.11.0（原型污染） | @graphql-codegen/plugin-helpers | 只有 12.0.1（跨主版本，plugin-helpers 5 需要 ^10） | 不升；codegen 只在建置時處理專案自己的型別 |
| moderate | uuid 9.0.1（v3/v5/v6 提供 buf 時缺邊界檢查） | bullmq 5.13.0 | 只有 11.1.1（跨主版本） | 不升；本專案不呼叫 uuid，bullmq 用法不帶 buf {unverified} |
| moderate | sprintf-js 1.0.3（無界精度 DoS） | umzug › argparse | 無 | CLI 參數解析；不接受外部輸入 |
| moderate | postcss-selector-parser 6.1.4（二次方複雜度） | @medusajs/admin-bundler › tailwindcss | 只有 7.x（跨主版本） | 只在建置 Admin 時處理專案 CSS |
| moderate | @opentelemetry/instrumentation-pg 0.52.0（暴露資料庫用法） | @medusajs/deps | 0.73.0 以上（0.x 跨版，可能不相容） | 本專案沒有啟用 OpenTelemetry instrumentation {unverified}；不升 |

結論：沒有 critical；兩條有同主版本修正（lodash、ajv）的會以 override 修掉；其餘四條 high／moderate 需要 Medusa 上游升級，待 Medusa 新版時重跑本稽核。「不接受外部輸入」的判斷來自上表的相依路徑（都在 CLI、遷移、建置工具鏈），不是逐行程式碼審查。

本檔不能證明：DAST（HawkScan）、速率限制、OAuth／寄信等 P8 之後的介面——P11-06 其餘部分等公開網址與 P8。
