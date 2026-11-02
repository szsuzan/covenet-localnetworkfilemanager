#!/usr/bin/env bash
# Build and restart the live app. Caddy keeps serving TLS on 3000.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
npm run build
systemctl --user restart fileshare.service
sleep 1
curl -s --cacert public/cove-ca.crt -o /dev/null -w "Cove is up: %{http_code}\n" \
  https://127.0.0.1:3000/login
