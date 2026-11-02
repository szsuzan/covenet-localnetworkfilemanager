# Cove

Private file and media server for a trusted LAN. Upload, browse, stream and share
files between accounts — with per-user private storage, two-factor auth and audit
logging.

```
Next.js 16 · SQLite · local filesystem · ffmpeg · sharp
```

## Access

- **http://LAN-IP:3000**
- Stable alternative: **http://HOST.local:3000** (mDNS — follows IP changes on the same LAN)
- TLS is currently **disabled** at the owner's request. Credentials and session
  cookies travel in plaintext on the LAN; keep this on a trusted network only.
- Port 3000 is already allowed through UFW from `LAN-SUBNET`.

### Changing networks

`HOST.local` is advertised by Avahi and points at whatever address the machine has,
so it keeps working when DHCP hands out a new IP. It needs multicast/mDNS to be
allowed on the network (most home/office Wi-Fi allows it; guest Wi-Fi and
client-isolated networks often do not).

- On the router, reserve `LAN-IP` for this laptop’s MAC so clients
  without mDNS keep working on this network.

### Remote access with Tailscale (any network)

Tailscale gives the machine a stable `100.x.y.z` address and a MagicDNS name that
work from any network, without exposing Cove to the internet.

```bash
./scripts/tailscale-setup.sh      # logs in, allows the app on tailscale0
```

Then either:

- **Direct (simplest):** `http://<tailscale-ip>:3000` or
  `http://cove.<your-tailnet>.ts.net:3000`. Traffic is already encrypted by
  WireGuard even though Cove itself speaks HTTP.
- **HTTPS without a port (nicer):**
  ```bash
  tailscale serve --bg 3000
  tailscale serve status
  ```
  This gives `https://cove.<your-tailnet>.ts.net` with a valid certificate.
  Enable **MagicDNS** and **HTTPS Certificates** in the Tailscale admin console
  first. It is tailnet-only — not public `funnel`.

Get the name/IP with:

```bash
tailscale status
tailscale ip -4
```

### No Wi-Fi: run a hotspot

Cove keeps running when the network disappears; only the address changes.

**Option A — use the laptop as the hotspot (with in-app QR sharing)**

Install the helper once (needs internet for `dnsmasq`):

```bash
sudo ./scripts/install-hotspot.sh
```

Then in **Admin → Offline hotspot**:

1. Choose an SSID and password
2. Click **Start hotspot**
3. Scan **1 · Join Wi-Fi**, then **2 · Open Cove**

Starting it disconnects the laptop from its current Wi-Fi, so open the admin
page on the laptop at `http://127.0.0.1:3000` first.

The CLI fallback is still available:

```bash
./scripts/hotspot.sh start
```

No internet is needed — the hotspot is just a local network. Phones may warn
“no internet” or try to switch to mobile data; keep them connected. `HOST.local`
may also work if the client supports mDNS; the IP is the reliable option.

**Option B — use your phone’s hotspot**

Turn on the phone hotspot and connect the laptop to it. Then:

```bash
ip -4 addr show WIFI-INTERFACE          # find the laptop's hotspot IP/subnet
sudo ufw allow from <subnet>/24 to any port 3000 proto tcp comment 'Cove hotspot'
```

Open the laptop’s hotspot IP from the phone or any other device on that hotspot.
Common subnets are `192.168.43.0/24` (Android) and `172.20.10.0/28` (iPhone).

**Notes**

- Tailscale needs internet; with no internet, use the hotspot IP instead.
- With no network at all, Cove still works on the laptop itself at
  `http://127.0.0.1:3000`.

To re-enable TLS later, see [SECURITY.md](SECURITY.md). The HTTPS/Caddy units are
installed but disabled.

## First login

The seeded admin account is `admin`. The original `admin123` password was flagged
for mandatory change and has since been replaced — use the password you set.
New passwords require at least 12 characters and 3 of: lowercase, uppercase,
numbers, symbols.

## Features

- Public space (everyone) and per-user Private space (owner only)
- Grid/list browsing, breadcrumbs, filename search, recent uploads, favorites
- Multi-select, bulk ZIP download, folder download as ZIP, bulk cut/delete
- Drag-and-drop, whole-folder and phone-camera uploads; pause/resume/cancel
- Delete to trash with restore; automatic purge after 30 days
- Image thumbnails and lightbox; video streaming with resume position
- Automatic HLS transcoding for MKV/HEVC/AVI and other non-native formats
- Audio, PDF and text preview
- Admin: users, roles, upload permission, reset password/2FA, storage dashboard,
  cleanup, audit log
- Dark and light themes; keyboard shortcuts (`/` search, `Ctrl+A` select all,
  `Delete`, `Esc`)

## Security

See [SECURITY.md](SECURITY.md) for the threat model and residual risks. Summary:

- Plain HTTP on port 3000 (TLS temporarily disabled — see SECURITY.md)
- Session cookie `HttpOnly`, `SameSite=Lax`; tokens stored hashed
- 30-day absolute / 7-day idle sessions, max 10 per user, revoke-all
- bcrypt (cost 12), password policy, forced change of the default password
- Persisted login throttling (10 failures per account+IP, 40 per IP per 15 min)
- Optional TOTP two-factor authentication with QR setup
- CSRF protection via Origin + `Sec-Fetch-Site` checks on every mutation
- Strict security headers and CSP; `X-Frame-Options`, `nosniff`, no-referrer
- Path-traversal guard on every file operation; private folders isolated per user
- SVG/HTML/XML/JS forced to download (no stored XSS); ZIP skips symlinks
- Upload chunk and file-size caps
- Audit log of logins, uploads, deletes, admin actions and password/2FA changes

## Storage

`STORAGE_ROOT` defaults to `/srv/cove/files`:

```
Public/                 visible to every signed-in user
Private/<username>/     visible only to that user
```

App data lives in `data/`:

```
app.db      users, sessions, favorites, watch progress, audit log, throttle
uploads/    in-progress chunked uploads
thumbs/     thumbnail cache
hls/        transcoded video cache
trash/      deleted items (30-day retention)
```

The filesystem is the source of truth. Hidden entries and symlinks are never listed.

## Configuration (`.env.local`)

```ini
STORAGE_ROOT=/srv/cove/files
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
COOKIE_SECURE=0          # 1 only when TLS is enabled
SESSION_IDLE_DAYS=7
MAX_UPLOAD_GB=200

TRANSCODE_CONCURRENCY=2
THUMB_CONCURRENCY_IMAGES=4
THUMB_CONCURRENCY_VIDEOS=2

UPLOAD_STALE_HOURS=24
TRASH_RETENTION_DAYS=30
HLS_RETENTION_DAYS=7
HLS_MAX_GB=10
THUMB_RETENTION_DAYS=90
THUMB_MAX_GB=2
CLEANUP_INTERVAL_HOURS=6
```

Cleanup runs every 6 hours and on the first page load; admins can trigger it
immediately with **Run cleanup**.

## Services

The app currently runs as the **system** unit `/etc/systemd/system/fileshare.service`
(`npm start`, port 3000, runs as `cove`, enabled at boot):

```bash
systemctl status fileshare
sudo systemctl restart fileshare     # after rebuilding
```

The user-level TLS units (`cove-caddy`, `cove-mux`, user `fileshare`) are
installed but disabled. The backup timer is user-level and active:

```bash
systemctl --user list-timers fileshare-backup.timer
journalctl --user -u fileshare-backup -n 20
```


## Backups

`scripts/backup.sh` writes hardlink snapshots of the files plus a consistent SQLite
copy, keeps 14 runs, and runs daily at 03:30 via `fileshare-backup.timer`:

```
/srv/cove/backups/
├── files/<timestamp>/ + latest -> …
├── db/app-<timestamp>.db
└── last-backup.txt
```

This is **the same disk**. Point `BACKUP_DEST` in
`~/.config/systemd/user/fileshare-backup.service` at an external/NAS mount for real
protection, then `systemctl --user daemon-reload && systemctl --user restart fileshare-backup.timer`.
Backups contain private files, so use an encrypted destination (e.g. restic) for
off-site copies.

## Development

```bash
npm run dev            # uses port 3000 on 0.0.0.0 (HTTP)
npm run typecheck
npm run build
```

For local HTTP dev, set `COOKIE_SECURE=0` in `.env.local` (otherwise the `Secure`
cookie will not be sent).

Key files:

```
lib/auth.ts        sessions, login, 2FA helpers
lib/security.ts    password policy, client IP
lib/loginGuard.ts  persisted login throttling
lib/totp.ts        TOTP generation/verification
lib/audit.ts       audit log writes
lib/paths.ts       Public/Private mapping + traversal guard
lib/trash.ts       trash/restore/purge
lib/transcode.ts   HLS queue
lib/cleanup.ts     retention jobs
app/api/stream     range streaming + inline-content hardening
app/api/upload     chunked uploads
components/        FileBrowser, Viewer, VideoPlayer, SecurityPanel, AdminPanel
deploy/Caddyfile   TLS reverse proxy
scripts/backup.sh  hardlink snapshot backup
```
