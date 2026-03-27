#!/usr/bin/env bash
set -euo pipefail

# Usage example:
#   REPO_SSH_URL="git@github.com:czang1987/garden.git" \
#   DOMAIN="" \
#   APP_USER="ubuntu" \
#   bash scripts/setup-aws-ubuntu.sh
#
# What this script does:
# - installs git / rsync / nginx / certbot / node 20 / pm2
# - prepares these directories:
#     ~/garden
#     /home/ubuntu/garden-stylize
#     /var/www/garden-app/dist
# - clones or updates the repo
# - builds the frontend once
# - syncs the frontend dist and backend server files
# - writes an nginx config for same-origin frontend + /api/ proxy
# - optionally starts pm2 if /home/ubuntu/garden-stylize/.env.stylize exists
#
# Notes:
# - If DOMAIN is empty, nginx will serve on port 80 as the default server for IP access.
# - If DOMAIN is set, nginx will use server_name DOMAIN and can later be upgraded with certbot.
# - The runtime env file is NOT created automatically. Put it at:
#     /home/ubuntu/garden-stylize/.env.stylize

APP_USER="${APP_USER:-ubuntu}"
APP_HOME="/home/${APP_USER}"
APP_REPO_DIR="${APP_REPO_DIR:-${APP_HOME}/garden}"
RUNTIME_DIR="${RUNTIME_DIR:-${APP_HOME}/garden-stylize}"
STATIC_DIR="${STATIC_DIR:-/var/www/garden-app/dist}"
REPO_SSH_URL="${REPO_SSH_URL:-}"
DOMAIN="${DOMAIN:-}"
API_PORT="${API_PORT:-8787}"
SETUP_CERTBOT="${SETUP_CERTBOT:-1}"

if [[ -z "${REPO_SSH_URL}" ]]; then
  echo "[setup] REPO_SSH_URL is required, for example: git@github.com:czang1987/garden.git"
  exit 1
fi

echo "[setup] updating apt packages"
sudo apt-get update

echo "[setup] installing base packages"
sudo apt-get install -y git rsync nginx curl ca-certificates gnupg

if [[ "${SETUP_CERTBOT}" == "1" ]]; then
  echo "[setup] installing certbot packages"
  sudo apt-get install -y certbot python3-certbot-nginx
fi

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null || true)" != v20* ]]; then
  echo "[setup] installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[setup] node already present: $(node -v)"
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[setup] installing pm2"
  sudo npm install -g pm2
else
  echo "[setup] pm2 already present"
fi

echo "[setup] preparing directories"
sudo mkdir -p "${STATIC_DIR}"
sudo chown -R "${APP_USER}:www-data" "/var/www/garden-app"
sudo find "/var/www/garden-app" -type d -exec chmod 775 {} \;
sudo find "/var/www/garden-app" -type f -exec chmod 664 {} \; || true
mkdir -p "${RUNTIME_DIR}/server"

if [[ ! -d "${APP_REPO_DIR}/.git" ]]; then
  echo "[setup] cloning repo into ${APP_REPO_DIR}"
  git clone "${REPO_SSH_URL}" "${APP_REPO_DIR}"
else
  echo "[setup] repo already exists, fetching latest refs"
  git -C "${APP_REPO_DIR}" fetch origin
fi

echo "[setup] installing repo dependencies"
cd "${APP_REPO_DIR}"
npm ci

echo "[setup] building frontend"
npm run build

echo "[setup] syncing frontend dist -> ${STATIC_DIR}"
rsync -a --delete "${APP_REPO_DIR}/dist/" "${STATIC_DIR}/"

echo "[setup] syncing backend runtime files -> ${RUNTIME_DIR}"
rsync -a "${APP_REPO_DIR}/server/" "${RUNTIME_DIR}/server/"
rsync -a "${APP_REPO_DIR}/package.json" "${APP_REPO_DIR}/package-lock.json" "${RUNTIME_DIR}/"

echo "[setup] installing runtime dependencies"
cd "${RUNTIME_DIR}"
npm ci

NGINX_FILE="/etc/nginx/sites-available/garden-app"

echo "[setup] writing nginx config to ${NGINX_FILE}"
if [[ -n "${DOMAIN}" ]]; then
  sudo tee "${NGINX_FILE}" >/dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    root ${STATIC_DIR};
    index index.html;

    client_max_body_size 20M;
    client_body_timeout 600s;
    keepalive_timeout 65s;

    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;

        proxy_set_header Connection "";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
        send_timeout 600s;

        proxy_buffering off;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
else
  sudo tee "${NGINX_FILE}" >/dev/null <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root ${STATIC_DIR};
    index index.html;

    client_max_body_size 20M;
    client_body_timeout 600s;
    keepalive_timeout 65s;

    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;

        proxy_set_header Connection "";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
        send_timeout 600s;

        proxy_buffering off;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
fi

sudo ln -sf "${NGINX_FILE}" /etc/nginx/sites-enabled/garden-app
sudo rm -f /etc/nginx/sites-enabled/default

echo "[setup] validating nginx config"
sudo nginx -t
sudo systemctl reload nginx

ENV_FILE="${RUNTIME_DIR}/.env.stylize"
if [[ -f "${ENV_FILE}" ]]; then
  echo "[setup] found ${ENV_FILE}, starting pm2 service"
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a

  if pm2 describe garden-stylize >/dev/null 2>&1; then
    pm2 restart garden-stylize --update-env
  else
    cd "${RUNTIME_DIR}"
    pm2 start server/index.mjs --name garden-stylize
  fi
  pm2 save
else
  echo "[setup] ${ENV_FILE} not found, skipping pm2 start"
  echo "[setup] create it later, then run:"
  echo "        cd ${RUNTIME_DIR} && set -a && source .env.stylize && set +a && pm2 start server/index.mjs --name garden-stylize"
fi

echo "[setup] done"
echo "[setup] frontend path: ${STATIC_DIR}"
echo "[setup] backend runtime path: ${RUNTIME_DIR}"
echo "[setup] repo path: ${APP_REPO_DIR}"
if [[ -n "${DOMAIN}" ]]; then
  echo "[setup] next optional step for https:"
  echo "        sudo certbot --nginx -d ${DOMAIN}"
fi
