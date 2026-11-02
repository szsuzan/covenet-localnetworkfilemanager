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

# Direct access: http://<tailscale-ip>:3000
sudo ufw allow in on tailscale0 to any port 3000 proto tcp comment 'Cove Tailscale' 2>/dev/null || true

# Optional HTTPS on the tailnet (no port): tailscale serve --bg 3000
sudo ufw allow in on tailscale0 to any port 443 proto tcp comment 'Cove Tailscale HTTPS' 2>/dev/null || true

IP="$(tailscale ip -4 2>/dev/null | head -1)"
echo
echo "Tailscale IP: ${IP:-not assigned}"
if [ -n "${IP:-}" ]; then
  echo "Direct URL:   http://${IP}:3000"
fi
echo
echo "For HTTPS without a port (needs HTTPS certificates enabled in the Tailscale admin console):"
echo "  tailscale serve --bg 3000"
echo "  tailscale serve status"
echo
tailscale status | head -5
