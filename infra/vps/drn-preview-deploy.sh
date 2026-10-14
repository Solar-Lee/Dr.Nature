#!/bin/bash
# [P12-26] Deploys the preview storefront (apps/storefront static export) to the shared VPS as a
# password-protected site, touching only drn resources (CLAUDE.md §1):
#   /var/www/drn/preview/releases/<sha12>  the export (root:root 755/644), `current` symlink
#   /opt/drn/drn.htpasswd                  the password file Aki generated (root:www-data 640)
#   /opt/drn/drn.conf.prev                 backup of the live drn.conf before the swap
#   /etc/nginx/sites-available/drn.conf    replaced by the repo copy; `nginx -t`, then reload
# Usage (from the repo root, on the Mac):
#   bash infra/vps/drn-preview-deploy.sh <ssh-key-path> <htpasswd-file>
# The key and the htpasswd are only passed to ssh/scp; nothing in them is read or printed.
# Rollback (content):  ssh ... 'sudo ln -sfn releases/<old> /var/www/drn/preview/current'
# Rollback (config):   ssh ... 'sudo install -o root -g root -m 644 /opt/drn/drn.conf.prev \
#                      /etc/nginx/sites-available/drn.conf && sudo nginx -t && sudo systemctl reload nginx'
set -euo pipefail
key="${1:-}"; htp="${2:-}"
[ -f "$key" ] && [ -f "$htp" ] || { echo "usage: $0 <ssh-key-path> <htpasswd-file>" >&2; exit 2; }
root="$(cd "$(dirname "$0")/../.." && pwd)"
host=ubuntu@151.145.69.134
ssh_() { ssh -i "$key" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes "$host" "$@"; }

sha="$(git -C "$root" rev-parse --short=12 HEAD)"
out="$root/apps/storefront/out"
[ -f "$out/index.html" ] && [ -f "$out/404.html" ] || { echo "build first: pnpm --dir apps/storefront build" >&2; exit 1; }
tmp="$(mktemp -d "${TMPDIR:-/tmp}/drn-preview.XXXXXX")"
# COPYFILE_DISABLE + --no-xattrs: no macOS extended attributes in the tarball (GNU tar on the VPS
# would print a warning per file).
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$tmp/site.tar.gz" -C "$out" .
size_kb=$(( $(stat -f %z "$tmp/site.tar.gz" 2>/dev/null || stat -c %s "$tmp/site.tar.gz") / 1024 ))
sum="$(shasum -a 256 "$tmp/site.tar.gz" | cut -d' ' -f1)"
echo "release $sha tarball ${size_kb} KiB"

# Baselines (read-only) and free space: stop if the disk is short (CLAUDE.md §1.2: no global cleanup).
ssh_ 'df -Pk / | awk "NR==2{print \"free_kb=\" \$4}"; echo "nginx_enabled=$(ls /etc/nginx/sites-enabled | wc -l)"; echo "containers=$(docker ps -q | wc -l)"; md5sum /etc/nginx/sites-available/drn.conf' | tee "$tmp/baseline.txt"
free_kb="$(sed -n 's/^free_kb=//p' "$tmp/baseline.txt")"
[ "$free_kb" -gt $(( size_kb * 10 + 300000 )) ] || { echo "VPS disk too low (${free_kb} KiB free); stop and report" >&2; exit 1; }

D="$(ssh_ 'mktemp -d /tmp/drn-upload.XXXXXX')"
scp -i "$key" -o BatchMode=yes -q "$tmp/site.tar.gz" "$root/infra/nginx/drn.conf" "$host:$D/"
scp -i "$key" -o BatchMode=yes -q "$htp" "$host:$D/drn.htpasswd"
ssh_ "cd '$D' && echo '$sum  site.tar.gz' | sha256sum -c -" >/dev/null

ssh_ bash -s "$sha" "$D" <<'REMOTE'
set -euo pipefail
sha="$1"; D="$2"; rel="/var/www/drn/preview/releases/$sha"
sudo install -d -o root -g root -m 755 /var/www/drn/preview /var/www/drn/preview/releases "$rel"
sudo tar -xzf "$D/site.tar.gz" -C "$rel" --no-same-owner
sudo find "$rel" -type d -exec chmod 755 {} +
sudo find "$rel" -type f -exec chmod 644 {} +
sudo chown -R root:root "$rel"
sudo ln -sfn "releases/$sha" /var/www/drn/preview/current
sudo install -d -o root -g root -m 755 /opt/drn
sudo install -o root -g www-data -m 640 "$D/drn.htpasswd" /opt/drn/drn.htpasswd
if ! cmp -s "$D/drn.conf" /etc/nginx/sites-available/drn.conf; then
  sudo install -o root -g root -m 644 /etc/nginx/sites-available/drn.conf /opt/drn/drn.conf.prev
  sudo install -o root -g root -m 644 "$D/drn.conf" /etc/nginx/sites-available/drn.conf
  if ! sudo nginx -t 2>"$D/nginx-t.err"; then
    cat "$D/nginx-t.err" >&2
    if grep -q drn.conf "$D/nginx-t.err"; then
      sudo install -o root -g root -m 644 /opt/drn/drn.conf.prev /etc/nginx/sites-available/drn.conf
      sudo nginx -t >/dev/null 2>&1 && echo "drn.conf restored, NOT reloaded" >&2
    else
      echo "nginx -t fails on a non-drn file: stop and report to Aki (CLAUDE.md §1.9)" >&2
    fi
    exit 3
  fi
  sudo systemctl reload nginx
  echo "nginx reloaded"
else
  echo "drn.conf unchanged"
fi
rm -rf "$D"
echo "current -> $(readlink /var/www/drn/preview/current)"
md5sum /etc/nginx/sites-available/drn.conf
REMOTE
rm -rf "$tmp"

echo "--- verify"
for u in https://dr.nature.smilelife.tw/ https://dr.nature.smilelife.tw/story/; do
  curl -sSI --max-time 15 "$u" | tr -d '\r' | grep -iE '^(HTTP/|www-authenticate|x-robots-tag)' | sed "s#^#$u #"
done
curl -sS -o /dev/null -w 'http://.../  %{http_code} %{redirect_url}\n' --max-time 15 http://dr.nature.smilelife.tw/
curl -sS -o /dev/null -w 'acme probe  %{http_code} (expect 404, not 401)\n' --max-time 15 http://dr.nature.smilelife.tw/.well-known/acme-challenge/drn-probe
