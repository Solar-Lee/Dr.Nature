# Runbook：對外連線（Cloudflare Tunnel、Access、WAF）

設定由 Aki 在 Cloudflare 後台完成（[deploy-backend.md](deploy-backend.md) §2 第 6 步）；本檔記錄規則原文、驗收與回滾。研究依據：[research/mac-mini-deploy-2026-10-13.md](../research/mac-mini-deploy-2026-10-13.md)「Cloudflare Tunnel／Access／WAF」。

## 名稱與資源

- `<API_HOST>`：D12 建議 `drn-api.smilelife.tw`（Universal SSL 只涵蓋第一層子網域）。寫進 `~/drn/.env`（`MEDUSA_BACKEND_URL`、`ADMIN_CORS`、`AUTH_CORS`）與 `~/drn/host.env`（`DRN_API_HOST`）。
- Tunnel `drn-tunnel`（**本機管理**，2026-10-14 改法）：`cloudflared tunnel login`（容器內執行，Aki 在瀏覽器點 Authorize 選 zone）把 `cert.pem` 寫進 `~/drn/cloudflared/`；`infra/host/drn-tunnel-setup.sh <API_HOST> [hooks-only|public]` 建立 tunnel、用 `tunnel route dns` 建 CNAME、寫 `config.yml` 並 `ingress validate`。憑證與設定檔 600，唯讀掛進 `drn-cloudflared`；沒有任何 token 經過剪貼簿或環境變數（原本的 `TUNNEL_TOKEN`／`tunnel.env` 作法不用了）。
- Ingress 模式：`hooks-only`（目前）只把 `/hooks/ecpay/*` 與 `/health` 送到後端，其餘路徑在邊緣回 404，所以 Access 建立前管理後台不對外；Access 兩個應用建好後改跑 `drn-tunnel-setup.sh <API_HOST> public` 再 `drn-compose up -d --force-recreate drn-cloudflared`。
- 2026-10-14 實測：tunnel `d2ae3221-f9f4-4882-a63b-08993e136eae`，1 條連線、協定 quic、邊緣節點 khh；`drn-api.smilelife.tw` 解析到 Cloudflare；邊緣憑證 SAN `smilelife.tw, *.smilelife.tw`；`/health` 200 OK；三條未簽章回呼 400；`/app`、`/admin/users/me`、`/store/products`、`/static/x`、`/auth/user/emailpass`、`/hooks/payment/ecpay_ecpay` 都 404；後端 access log 的 client_ip 等於 `/cdn-cgi/trace` 的 ip。
- Access 應用：`drn-api-admin`（整個主機名稱，Allow，只放 Aki 的信箱，session 24h）；`drn-api-public`（`<API_HOST>/hooks/ecpay/*`、`<API_HOST>/health`，Bypass，Everyone）。Bypass 優先於整個主機名稱的 Allow：2026-10-14 用 curl 驗證（見下方「2026-10-14 實際設定」）。
- **2026-10-14 實際設定**（Aki 在對話中逐項核准，CODE 在 Cloudflare 後台操作）：
  - Zero Trust 組織沿用帳號既有的 Free 組織，team domain `daisysos.cloudflareaccess.com`（與其他專案共用；只新增 drn 開頭的應用與政策，其餘不動）。登入方式：One-time PIN（Email 收驗證碼）。
  - `drn-api-admin`：app id `0875e806-680a-44f8-a397-14b1a6ffd6fc`，政策 `drn-api-admin-allow`（`9ca076b9-c379-41a5-a5c8-9d601c79d580`，Include Emails = Aki 的信箱，Allow）。`drn-api-public`：app id `399cf814-3280-4c53-a5a3-ca42af80bdaf`，政策 `drn-api-public-bypass`（`1f640a86-3938-4143-9930-781b1452596b`，Include Everyone，Bypass）。
  - 注意：先建 admin 應用、再建 bypass 應用的這段時間，回呼與 `/health` 會被 Access 擋（302）。重建時兩個應用要連續建好，或先建 bypass。
  - WAF：zone `smilelife.tw` 原本 0/5 custom rules、0/1 rate limiting、managed rules 需升級（Free 沒有）。新增 `drn-ecpay-callback-skip`（第 1 條，Skip：其餘 custom rules、rate limiting、managed rules；記錄 log）。Bot Fight Mode **關**（D13 不需 IP 規則）；Browser Integrity Check **開**（是否影響綠界回呼由 P12-10 實測）。
  - 通知：`drn-tunnel-health`（只選 `drn-tunnel`，不含未來 tunnel；healthy／degraded／down 都通知）與 `drn-tunnel-create-delete`（帳號層級），都寄 Aki 的信箱。
  - DNS：刪除 `api.dr.nature.smilelife.tw` A（原值 151.145.69.134，DNS only，TTL Auto；回滾就照此加回）。`dr.nature.smilelife.tw` **維持指向 VPS 暫時頁**：它是兩層子網域，Free 方案的 Universal SSL 不涵蓋，走 Tunnel 會沒有有效憑證（研究已查證）；Aki 2026-10-14 選「暫時頁先留 VPS」，不買 ACM。
  - Access 的 Bypass 是**前綴**比對（含子路徑、不分大小寫）。所以 `public` ingress 只放行 `^/hooks/ecpay/(payment|payment-info|logistics)$` 與 `^/health$`，同前綴的其他路徑（`(?i)^/+(health|hooks/+ecpay)`）在 tunnel 回 404，其餘路徑才送到 Access 後面的後端。改規則後用 `drn-docker run --rm -v <含 config.yml 的暫存目錄>:/cfg:ro <cloudflared image> tunnel --config /cfg/config.yml ingress rule https://<API_HOST><path>` 逐條確認。
  - Ingress 2026-10-14 09:29Z 改為 `public`（09:42Z 再改成上面的精確路徑版）；切換前的 hooks-only 設定備份在 `~/drn/cloudflared/config.yml.hooks-only-20261014`。access-baseline：`status=302 location=daisysos.cloudflareaccess.com mitigated=0`。
- WAF custom rule `drn-ecpay-callback-skip`（第一條）：`(http.host eq "<API_HOST>" and http.request.method eq "POST" and starts_with(http.request.uri.path, "/hooks/ecpay/"))` → Skip 其餘 custom rules、rate limiting、managed rules。
- Bot Fight Mode（D13）：開著就對綠界 postgate 的 IP 建 zone 層級 IP Access rule Allow；演練期間替 Mac 當下的對外 IP（`https://<API_HOST>/cdn-cgi/trace` 的 `ip=`）建暫時規則，結束後刪。
- 通知：Tunnel Health Alert、Tunnel Creation／Deletion（Email）。

## 啟用與驗收（P12-04 後半，CODE）

```bash
touch ~/drn/state/edge-enabled && ~/drn/bin/drn-compose up -d --wait drn-cloudflared
~/drn/bin/drn-docker logs drn-cloudflared 2>&1 | grep -c 'Registered tunnel connection'     # ≥1
openssl s_client -connect <API_HOST>:443 -servername <API_HOST> </dev/null 2>/dev/null | openssl x509 -noout -ext subjectAltName
curl -fsS https://<API_HOST>/health                                                           # OK
for p in /app /admin/users/me /store/products /static/x; do curl -s -o /dev/null -w "$p %{http_code} %{redirect_url}\n" https://<API_HOST>$p; done
for p in payment payment-info logistics; do curl -s -w ' %{http_code}\n' -X POST -d a=1 https://<API_HOST>/hooks/ecpay/$p; done
curl -s https://<API_HOST>/cdn-cgi/trace | grep '^ip='
~/drn/bin/drn-docker logs --since 10m drn-backend 2>&1 | jq -rR 'fromjson? | select(.path == "/health") | .client_ip' | tail -1
~/drn/bin/drn-docker inspect -f '{{json .NetworkSettings.Networks}}' drn-cloudflared | jq -r 'keys[]'   # 只有 drn_edge
bash ~/drn/bin/drn-monitor.sh --record-access-baseline
```

預期：受保護的四個路徑都是 302 到 `*.cloudflareaccess.com`（或 403），沒有任何一個 200；三條回呼 400 `0|CheckMacValue Error`；`client_ip` 等於 trace 的 `ip`；access-baseline 不含 cf-mitigated。記錄連線協定（quic 或 http2；QUIC 不通就在 compose 的 command 加 `--protocol http2`）。

## 回滾

`rm ~/drn/state/edge-enabled && ~/drn/bin/drn-compose stop drn-cloudflared`；Cloudflare 端刪 route、CNAME、Access 應用、WAF 規則，或 Rotate token，`: > ~/drn/tunnel.env`。只想退回 hooks-only：`bash ~/drn/bin/drn-tunnel-setup.sh <API_HOST> hooks-only && ~/drn/bin/drn-compose up -d --force-recreate --no-deps drn-cloudflared`，再 `drn-monitor.sh --record-access-baseline`。

## 不能證明

綠界 postgate 是否接受 Cloudflare 的 ECDSA 邊緣憑證、是否會被 Bot Fight Mode 擋：只有 P12-10 的真實回呼能證明；cloudflared 是否轉送 `X-Forwarded-Proto`（Admin cookie 需要）：P12-22 登入實測。
