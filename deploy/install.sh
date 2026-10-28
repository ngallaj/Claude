#!/usr/bin/env bash
# Installs or updates the site on a fresh Ubuntu 22.04/24.04 server with automatic HTTPS (Caddy + Let's Encrypt).
# Run as root from the project folder:   sudo bash deploy/install.sh yourdomain.az [you@email.com]
# Re-run the same command after `git pull` to deploy an update.
set -euo pipefail

DOMAIN="${1:?Usage: sudo bash deploy/install.sh <domain> [email]}"
EMAIL="${2:-}"
APP_DIR=/opt/bextim
DATA_DIR=/var/lib/bextim
BACKUP_DIR=/var/backups/bextim
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }

echo "==> Installing system packages"
apt-get update -q
apt-get install -y -q curl ca-certificates gnupg rsync debian-keyring debian-archive-keyring apt-transport-https

if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])\.'; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "==> Installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

echo "==> Copying the app to $APP_DIR"
id bextim &>/dev/null || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin bextim
mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
rsync -a --delete --exclude node_modules --exclude data --exclude .git "$SRC_DIR"/ "$APP_DIR"/
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)
chown -R bextim:bextim "$DATA_DIR" "$BACKUP_DIR"

echo "==> Configuring the service"
install -m 644 "$APP_DIR/deploy/bextim.service" /etc/systemd/system/bextim.service
systemctl daemon-reload
systemctl enable -q bextim
systemctl restart bextim

echo "==> Configuring HTTPS for $DOMAIN"
{
  [ -n "$EMAIL" ] && printf '{\n\temail %s\n}\n\n' "$EMAIL"
  printf 'www.%s {\n\tredir https://%s{uri} permanent\n}\n\n' "$DOMAIN" "$DOMAIN"
  printf '%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:3000\n}\n' "$DOMAIN"
} > /etc/caddy/Caddyfile
systemctl enable -q caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "==> Daily backup at 03:30 to $BACKUP_DIR"
cat > /etc/cron.d/bextim-backup <<CRON
30 3 * * * bextim cd $APP_DIR && DATA_DIR=$DATA_DIR /usr/bin/node --disable-warning=ExperimentalWarning src/backup.js $BACKUP_DIR >/dev/null 2>&1
CRON

if command -v ufw >/dev/null; then
  echo "==> Firewall: allowing SSH, HTTP, HTTPS"
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
fi

sleep 2
if curl -fs -o /dev/null http://127.0.0.1:3000/api/meta; then
  echo
  echo "Done! Open https://$DOMAIN (the certificate can take a minute the first time)."
  echo "Make yourself admin after registering on the site:"
  echo "  sudo -u bextim DATA_DIR=$DATA_DIR node $APP_DIR/src/make-admin.js <your phone>"
else
  echo "The app did not start. See: journalctl -u bextim -n 50"; exit 1
fi
