#!/usr/bin/env bash
# Build and restart the live service. The restart is required: Next keeps the
# old build's asset manifest in memory, so rebuilding alone leaves the browser
# requesting chunks that no longer exist.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
npm run build
sudo systemctl restart fileshare
sleep 1
curl -s -o /dev/null -w "Cove is up: %{http_code}\n" http://127.0.0.1:3000/login
