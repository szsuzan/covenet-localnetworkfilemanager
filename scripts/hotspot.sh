#!/usr/bin/env bash
# Run Cove over a local Wi-Fi hotspot when there is no router/network.
# Usage: ./scripts/hotspot.sh start | stop | status
set -euo pipefail

IFACE="${HOTSPOT_IFACE:-WIFI-INTERFACE}"
SSID="${HOTSPOT_SSID:-Cove}"
CON="Cove-Hotspot"
ACTION="${1:-start}"

require_ap() {
  if ! iw list 2>/dev/null | sed -n '/Supported interface modes/,/Band/p' | grep -q '\* AP'; then
    echo "Wi-Fi adapter $IFACE does not support AP mode." >&2
    exit 1
  fi
}

allow_ufw() {
  local port="$1" proto="$2" comment="$3"
  if ! sudo ufw status 2>/dev/null | grep -qE "${port}/${proto}.*${SUBNET}"; then
    sudo ufw allow from "$SUBNET" to any port "$port" proto "$proto" comment "$comment" >/dev/null
  fi
}

case "$ACTION" in
  start)
    require_ap
    if ! command -v dnsmasq >/dev/null 2>&1; then
      echo "dnsmasq is required for a NetworkManager hotspot." >&2
      echo "Install it with: sudo pacman -S dnsmasq" >&2
      exit 1
    fi
    PASS="${HOTSPOT_PASSWORD:-}"
    if [ -z "$PASS" ]; then
      read -rsp "Hotspot password (at least 8 characters): " PASS
      echo
    fi
    if [ "${#PASS}" -lt 8 ]; then
      echo "Password must be at least 8 characters." >&2
      exit 1
    fi

    echo "Starting hotspot '$SSID' on $IFACE (this disconnects the current Wi-Fi)…"
    sudo nmcli connection delete "$CON" >/dev/null 2>&1 || true
    sudo nmcli device wifi hotspot ifname "$IFACE" con-name "$CON" ssid "$SSID" password "$PASS"

    IP="$(nmcli -g IP4.ADDRESS connection show "$CON" 2>/dev/null | head -1 | cut -d/ -f1 || true)"
    [ -z "${IP:-}" ] && IP="10.42.0.1"
    SUBNET="${IP%.*}.0/24"

    if ! sudo ufw status 2>/dev/null | grep -qE "67/udp on ${IFACE}.*ALLOW"; then
      sudo ufw allow in on "$IFACE" to any port 67 proto udp comment "Cove hotspot DHCP" >/dev/null
    fi
    allow_ufw 3000 tcp "Cove hotspot"
    allow_ufw 22 tcp "Cove hotspot SSH"
    allow_ufw 53 udp "Cove hotspot DNS"
    allow_ufw 5353 udp "Cove hotspot mDNS"

    HOST="$(hostnamectl --static 2>/dev/null || hostname)"
    cat <<EOF

Hotspot is running.
  SSID:      $SSID
  Password:  $PASS
  Cove:      https://$IP:3000
  mDNS:      https://$HOST.local:3000   (if the client supports mDNS)

Install the Cove CA from /cove-ca.crt once. There is no internet, so phones
may warn or try to switch to mobile data; keep them on the hotspot.
EOF
    ;;

  stop)
    sudo nmcli connection down "$CON" 2>/dev/null || true
    echo "Hotspot stopped. Reconnect to a normal Wi-Fi network when ready."
    ;;

  status)
    nmcli -t -f NAME,DEVICE,STATE connection show --active
    ;;

  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
