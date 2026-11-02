#!/usr/bin/env bash
# One-time setup for the Admin → Offline hotspot panel.
# Run: sudo ./scripts/install-hotspot.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo ./scripts/install-hotspot.sh" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${SUDO_USER:-}"
if [ -z "$APP_USER" ]; then
  echo "Run this with sudo from the account that owns the CoveNet checkout." >&2
  exit 1
fi

if ! command -v dnsmasq >/dev/null 2>&1; then
  echo "Installing dnsmasq (needed for DHCP/DNS on the hotspot)…"
  pacman -S --needed --noconfirm dnsmasq
fi

install -m 0755 "$APP_DIR/scripts/cove-hotspot" /usr/local/bin/cove-hotspot

cat > /etc/sudoers.d/cove-hotspot <<EOF
$APP_USER ALL=(root) NOPASSWD: /usr/local/bin/cove-hotspot
EOF
chmod 0440 /etc/sudoers.d/cove-hotspot
visudo -cf /etc/sudoers.d/cove-hotspot >/dev/null

echo
echo "Hotspot helper installed."
echo "  user:     $APP_USER"
echo "  helper:   /usr/local/bin/cove-hotspot"
echo "  sudoers:  /etc/sudoers.d/cove-hotspot"
echo
echo "Open Admin → Offline hotspot in CoveNet (preferably on the laptop at"
echo "https://127.0.0.1:3000, because starting the hotspot disconnects Wi-Fi)."
