#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "[deploy] Pulling latest changes..."
git pull origin production

echo "[deploy] Trusting GitHub host key..."
ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null

echo "[deploy] Updating providers to GitHub source..."
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.dependencies['@p-stream/providers'] = 'github:xp-technologies-dev/private-providers';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "[deploy] Installing dependencies..."
pnpm i

echo "[deploy] Building..."
pnpm build

echo "[deploy] Restarting pm2..."
pm2 restart pstream

echo "[deploy] Done."
