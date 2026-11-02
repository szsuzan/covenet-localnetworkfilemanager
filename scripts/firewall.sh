#!/usr/bin/env bash
# Tighten UFW for Cove. Run as root: sudo ./scripts/firewall.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo ./scripts/firewall.sh" >&2
  exit 1
fi
command -v ufw >/dev/null || {
  echo "ufw is not installed" >&2
  exit 1
}

LAN_IF=$(ip -4 route get 1.1.1.1 2>/dev/null |
  awk '{ for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }')
LAN_CIDR=$(ip -4 route show dev "${LAN_IF:-}" scope link 2>/dev/null |
  awk '$1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/[0-9]+$/ { print $1; exit }')
LAN6_CIDR=$(ip -6 route show dev "${LAN_IF:-}" 2>/dev/null |
  awk '$1 ~ /^[0-9a-fA-F:]+\/[0-9]+$/ && $1 !~ /^fe80:/ { print $1; exit }')
HOTSPOT_CIDR="${HOTSPOT_CIDR:-10.42.0.0/24}"

if [ -z "${LAN_IF:-}" ] || [ -z "${LAN_CIDR:-}" ]; then
  echo "Could not detect the LAN interface/subnet" >&2
  exit 1
fi

# Remove old broad rules for ports this script owns, highest number first.
delete_port() {
  local port="$1"
  ufw status numbered |
    sed -nE "s/^\[[[:space:]]*([0-9]+)\].*${port}\/[a-z]+.*ALLOW.*/\1/p" |
    sort -nr |
    while read -r number; do
      ufw --force delete "$number" >/dev/null
    done
}

echo "LAN:      ${LAN_IF} ${LAN_CIDR}${LAN6_CIDR:+ ${LAN6_CIDR}}"
echo "Hotspot:  ${HOTSPOT_CIDR}"

for port in 3000 22 443 8443 53 67 5353; do
  delete_port "$port"
done

# OpenSSH may be represented as an application profile rather than 22/tcp.
while ufw status | grep -q 'OpenSSH'; do
  ufw --force delete allow OpenSSH >/dev/null || break
done

ufw default deny incoming
ufw default allow outgoing

# Cove: HTTPS and the HTTP redirect share 3000. UDP is Caddy HTTP/3.
for proto in tcp udp; do
  ufw allow from "$LAN_CIDR" to any port 3000 proto "$proto" comment 'Cove LAN'
  ufw allow from "$HOTSPOT_CIDR" to any port 3000 proto "$proto" comment 'Cove hotspot'
  if ip link show tailscale0 >/dev/null 2>&1; then
    ufw allow in on tailscale0 to any port 3000 proto "$proto" comment 'Cove Tailscale'
  fi
done

# SSH: LAN and Tailscale only. Established sessions are not dropped by UFW.
ufw allow from "$LAN_CIDR" to any port 22 proto tcp comment 'SSH LAN'
if ip link show tailscale0 >/dev/null 2>&1; then
  ufw allow in on tailscale0 to any port 22 proto tcp comment 'SSH Tailscale'
fi

# mDNS so <host>.local keeps resolving.
ufw allow from "$LAN_CIDR" to any port 5353 proto udp comment 'Cove mDNS'
ufw allow from "$HOTSPOT_CIDR" to any port 5353 proto udp comment 'Cove hotspot mDNS'

# Hotspot DHCP/DNS. DHCPDISCOVER comes from 0.0.0.0, so match the interface.
ufw allow in on "$LAN_IF" to any port 67 proto udp comment 'Cove hotspot DHCP'
ufw allow from "$HOTSPOT_CIDR" to any port 53 proto udp comment 'Cove hotspot DNS'
ufw allow from "$HOTSPOT_CIDR" to any port 53 proto tcp comment 'Cove hotspot DNS'

# IPv6 LAN, when the link has a global prefix.
if [ -n "${LAN6_CIDR:-}" ]; then
  for proto in tcp udp; do
    ufw allow from "$LAN6_CIDR" to any port 3000 proto "$proto" comment 'Cove LAN v6'
  done
  ufw allow from "$LAN6_CIDR" to any port 22 proto tcp comment 'SSH LAN v6'
  ufw allow from "$LAN6_CIDR" to any port 5353 proto udp comment 'Cove mDNS v6'
fi

ufw --force enable
ufw reload
echo
ufw status numbered
