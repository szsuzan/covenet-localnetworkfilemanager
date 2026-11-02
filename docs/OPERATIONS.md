# Cove operations

Install, run, certificate, backup and troubleshooting notes for the Cove server.
For user and admin behavior see the [User guide](USER_GUIDE.md) and
[Admin guide](ADMIN_GUIDE.md).

## Architecture

```
client
  │  HTTPS :3000  (plain HTTP gets a 308 redirect)
  ▼
Caddy  ──  TLS, static certificate, security headers, reverse proxy
  │  127.0.0.1:3100
  ▼
Next.js  ──  app, APIs, streaming, thumbnails, HLS jobs
  ├── SQLite        data/app.db
  ├── /srv/cove/files/{Public,Private}
  └── data/{uploads,thumbs,hls,trash}
```

Only Caddy listens on the network. Next is loopback-only. Caddy's built-in
`http_redirect` wrapper turns plain HTTP on port 3000 into a `308` to the same
URL over HTTPS; there is no separate HTTP port and no mux process.

## Prerequisites

- Linux with systemd user services and linger enabled.
- Node.js 20.9+ and npm (tested with Node 26).
- `ffmpeg`/`ffprobe` for video metadata, HLS and thumbnails.
- ImageMagick (`magick` or `convert`) for HEIC/TIFF previews.
- Caddy with the `http_redirect` listener wrapper (tested with 2.11.7).
- `rsync` and `sqlite3` for backups.
- Optional: `tailscale`, `dnsmasq`, `ufw` for remote access, hotspot and firewall.

## Install

```bash
git clone <repo-url> cove
cd cove
npm ci
cp .env.example .env.local
```

Edit `.env.local`:

```ini
STORAGE_ROOT=/srv/cove/files
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-before-first-start
COOKIE_SECURE=1
TRUST_PROXY=1
```

`ADMIN_PASSWORD` is only used when the database has no users. Changing it later
does not reset an existing admin password.

Build and install the user units:

```bash
npm run build
mkdir -p ~/.config/systemd/user
cp deploy/systemd-user/*.service deploy/systemd-user/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
loginctl enable-linger "$USER"
```

### Certificate bootstrap

`deploy/issue-cert.sh` signs a certificate with Caddy's local root CA. On an
existing Cove machine that CA is already at:

```
~/.local/share/caddy/pki/authorities/local/root.crt
~/.local/share/caddy/pki/authorities/local/root.key
```

On a brand-new machine, let Caddy create its local CA once (for example by
starting it briefly with a temporary `tls internal` site), then stop it. If the
files above are missing, the certificate script exits with an error instead of
creating a second CA.

Then issue the Cove certificate and start the services:

```bash
./deploy/issue-cert.sh
systemctl --user enable --now fileshare.service cove-caddy.service
```

Create the storage directories if they do not exist:

```bash
mkdir -p /srv/cove/files/{Public,Private}
chmod 700 /srv/cove/files
```

## Services

Both units are user-level and enabled at boot:

```bash
systemctl --user status fileshare cove-caddy
systemctl --user restart fileshare     # after a build
systemctl --user restart cove-caddy    # after a certificate change
journalctl --user -u fileshare -u cove-caddy -n 100 --no-pager
```

`./scripts/deploy.sh` builds the app, restarts `fileshare`, and verifies HTTPS.
The old system unit `/etc/systemd/system/fileshare.service` is disabled; do not
enable it again or it will compete for port 3000.

### Health checks

```bash
ss -ltnp | grep -E ':3000|:3100'
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3000/login
curl -s --cacert public/cove-ca.crt -o /dev/null -w '%{http_code}\n' \
  https://127.0.0.1:3000/login
```

Expected: HTTP `308` to `https://…:3000/login`; HTTPS `200`. Port `3000` belongs
to Caddy, `3100` to Next, and `3100` must not be reachable from the LAN.

## Certificate and CA

The certificate is static and signed directly by the Caddy local root CA:

```bash
./deploy/issue-cert.sh
```

What the script does:

- detects the current LAN IP and Tailscale IP/name;
- builds SANs for `HOST.local`, `localhost`, `127.0.0.1`, `10.42.0.1`, the LAN IP,
  the Tailscale IP and the MagicDNS name;
- signs a 397-day leaf with the Caddy root CA;
- writes `data/caddy/cove.crt` and `data/caddy/cove.key`;
- copies the root CA to `public/cove-ca.crt`;
- restarts `cove-caddy`.

Re-run it after a LAN/Tailscale address change and before expiry. The private key
is mode `600` under `data/`; keep it there. HSTS is intentionally not enabled
until every client trusts the CA, so a certificate warning does not lock clients
out of the site.

### Trust the CA on a client

First visit `https://HOST.local:3000`, continue past the warning, and download
`/cove-ca.crt` from the login page. Then install it as a trusted root/CA:

- **Linux / Chrome / Brave:** import into the browser or NSS store, or use the
  OS trust store where supported.
- **Firefox:** Settings → Privacy & Security → Certificates → View Certificates
  → Authorities → Import.
- **macOS:** Keychain Access → System → import the certificate → Trust → Always
  Trust.
- **Windows:** double-click the certificate → Install Certificate → Local
  Machine → Trusted Root Certification Authorities.
- **iPhone/iPad:** download the profile, install it in Settings → General → VPN
  & Device Management, then enable full trust in Settings → General → About →
  Certificate Trust Settings.
- **Android:** Settings → Security → Encryption & credentials → Install a
  certificate → CA certificate (wording varies by vendor).

Do not distribute the root CA private key. Only `public/cove-ca.crt` (the public
root certificate) is meant for clients.

## Network access

### LAN / mDNS

`HOST.local` is advertised by Avahi and follows the laptop's current address.
Multicast/mDNS must be allowed on the Wi-Fi. Use the current LAN IP as a fallback:

```bash
hostname -I
```

### Tailscale

```bash
./scripts/tailscale-setup.sh
tailscale status
tailscale ip -4
```

Use `https://TAILSCALE-IP:3000` or
`https://HOST.TAILNET.ts.net:3000`, and install the Cove CA on the remote
device. Port 3000 is the only inbound port; no public funnel is needed.

### Firewall

Apply the scoped rules with:

```bash
sudo ./scripts/firewall.sh
```

The script detects the LAN interface/subnet, removes old broad rules for ports
22, 443, 8443, 3000, 53, 67 and 5353, then allows only:

| Port | Source |
|---|---|
| 3000 TCP/UDP | LAN, hotspot, `tailscale0` |
| 22 TCP | LAN, `tailscale0` |
| 5353 UDP | LAN and hotspot (mDNS) |
| 67 UDP | Wi-Fi interface (hotspot DHCP) |
| 53 UDP/TCP | hotspot subnet (DNS) |

It keeps the default incoming policy at deny and does not open SSH on the
hotspot. Run it again after a LAN subnet change. Override the hotspot subnet with
`HOTSPOT_CIDR=…` if you changed it.

Do not forward port 3000 from the internet. Confirm the result with:

```bash
sudo ufw status numbered
ss -ltnp | grep -E ':3000|:22'
```

### Hotspot

The in-app hotspot is documented in the [Admin guide](ADMIN_GUIDE.md#offline-hotspot).
The helper needs a one-time install:

```bash
sudo ./scripts/install-hotspot.sh
```

## Backups

`scripts/backup.sh` makes hardlink snapshots of `STORAGE_ROOT`, a consistent
SQLite copy of `data/app.db`, and keeps the last 14 runs. It runs daily at 03:30
through `fileshare-backup.timer`.

The destination is configured in
`~/.config/systemd/user/fileshare-backup.service`:

```ini
Environment=BACKUP_DEST=/srv/cove/backups
```

The current destination is the **same disk**. Point it at an external/NAS mount
and use an encrypted repository (restic/borg) for real protection. Backups
contain private files.

Check backups:

```bash
systemctl --user list-timers fileshare-backup.timer
journalctl --user -u fileshare-backup -n 50 --no-pager
ls -la /srv/cove/backups
```

### Restore outline

1. Stop the app: `systemctl --user stop fileshare cove-caddy`.
2. Restore the desired `files/<timestamp>/` snapshot to `STORAGE_ROOT`.
3. Restore the matching `db/app-<timestamp>.db` to `data/app.db`.
4. Fix ownership/permissions (`data/` 700, database 600, `.env.local` 600).
5. Start `fileshare` and `cove-caddy`.
6. Verify login, Public/Private browsing, and a video.

The certificate lives outside the backup; regenerate it with
`./deploy/issue-cert.sh` if the machine changes.

## Updates

```bash
git pull
npm ci
./scripts/deploy.sh
npm audit
```

Read the diff before replacing a live build. After an update, verify the login,
Public and Private spaces, uploads, video playback and PDF preview.

## Troubleshooting

| Symptom | Check |
|---|---|
| Browser warning | CA not trusted on that device; install `/cove-ca.crt` |
| `http://` does not load the app | It should return 308; if not, Caddy is down or another process owns 3000 |
| `502 Bad Gateway` | `fileshare` is down or still building; check `systemctl --user status fileshare` |
| `400 Bad Request` | A client sent malformed plain HTTP to the TLS port; use `https://` |
| Login redirects back to login | Use HTTPS, clear the old `http://` tab, check the clock and cookie settings |
| `HOST.local` points to an unreachable address | Use the current LAN IP; check mDNS/multicast |
| Certificate mismatch after network change | Re-run `./deploy/issue-cert.sh` |
| Port 3000 already in use | `ss -ltnp \| grep 3000`; ensure the old system unit is disabled |
| Hotspot has no URL | Install the helper, check `dnsmasq`, and start it from the admin page |
| Tailscale unreachable | `tailscale status`, UFW rule on `tailscale0`, install the CA on the client |
| Video does not start | Check `journalctl --user -u fileshare` and ffmpeg availability |
| Disk filling up | Admin → Run cleanup; inspect `data/hls`, `data/trash` and uploads |

Useful logs:

```bash
journalctl --user -u fileshare -f
journalctl --user -u cove-caddy -f
```

## Security

Cove is for a trusted private network. The threat model, accepted risks and
remaining actions are in [Security](../SECURITY.md) and
[the audit](../SECURITY_AUDIT.md). Important operational items:

- restrict SSH and use keys;
- run the app as a dedicated user rather than the login user when feasible;
- scan untrusted media or do not upload/execute untrusted binaries;
- use an external, encrypted backup destination;
- enable 2FA for admins;
- keep dependencies and media parsers updated.
