#!/usr/bin/env bash
# Bring Tailscale up for Cove and allow the app through the firewall on the
# tailnet interface. Run once: ./scripts/tailscale-setup.sh
set -euo pipefail

if ! command -v tailscale >/dev/null; then
  echo "tailscale is not installed" >&2
  exit 1
fi

echo "Logging in to Tailscale (open the URL it prints if prompted)…"
sudo tailscale up

# Let the current user manage serve/funnel without sudo afterwards.
sudo tailscale set --operator="$USER" 2>/dev/null || true

# Direct access: https://<tailscale-ip>:3000 (trust /cove-ca.crt once)
sudo ufw allow in on tailscale0 to any port 3000 proto tcp comment 'Cove Tailscale' 2>/dev/null || true

IP="$(tailscale ip -4 2>/dev/null | head -1)"
echo
echo "Tailscale IP: ${IP:-not assigned}"
if [ -n "${IP:-}" ]; then
  echo "Direct URL:   https://${IP}:3000"
fi
echo "Install the Cove CA from https://<tailscale-name>:3000/cove-ca.crt once."
echo
tailscale status | head -5
