#!/usr/bin/env bash
set -euo pipefail

# Re-run after the LAN or Tailscale IP changes. The cert is signed by Caddy's
# local root CA, so clients must trust public/cove-ca.crt.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CA="$HOME/.local/share/caddy/pki/authorities/local"
OUT="$ROOT/data/caddy"

[ -r "$CA/root.crt" ] && [ -r "$CA/root.key" ] || {
  echo "Caddy root CA missing under $CA" >&2
  exit 1
}

LAN_IP=$(ip -4 route get 1.1.1.1 2>/dev/null |
  awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
[ -n "$LAN_IP" ] || LAN_IP=$(hostname -I | awk '{print $1}')
TS_IP=$(tailscale ip -4 2>/dev/null | head -1 || true)
TS_NAME=$(tailscale status --json 2>/dev/null |
  jq -r '.Self.DNSName // empty' | sed 's/\.$//')
HOST=$(hostname).local

SANS="DNS:$HOST,DNS:localhost,IP:127.0.0.1,IP:10.42.0.1"
[ -n "$LAN_IP" ] && SANS="$SANS,IP:$LAN_IP"
[ -n "$TS_IP" ] && SANS="$SANS,IP:$TS_IP"
[ -n "$TS_NAME" ] && SANS="$SANS,DNS:$TS_NAME"

umask 077
mkdir -p "$OUT"
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout "$OUT/cove.key" -out "$OUT/cove.csr" -subj "/CN=$HOST" >/dev/null 2>&1

cat >"$OUT/ext.cnf" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=$SANS
EOF

openssl x509 -req -in "$OUT/cove.csr" -CA "$CA/root.crt" -CAkey "$CA/root.key" \
  -set_serial "0x$(openssl rand -hex 16)" -days 397 -sha256 \
  -extfile "$OUT/ext.cnf" -out "$OUT/cove.crt" >/dev/null 2>&1

rm -f "$OUT/cove.csr" "$OUT/ext.cnf"
chmod 600 "$OUT/cove.key"
chmod 644 "$OUT/cove.crt"
install -m 644 "$CA/root.crt" "$ROOT/public/cove-ca.crt"
openssl verify -CAfile "$CA/root.crt" "$OUT/cove.crt"

echo "Issued $OUT/cove.crt"
echo "SANs: $SANS"
echo "Restarting CoveNet TLS proxy..."
systemctl --user restart cove-caddy.service
