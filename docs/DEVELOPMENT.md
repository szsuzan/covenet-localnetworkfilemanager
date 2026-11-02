# Cove development

This is a small self-hosted Next.js app. Keep changes direct, keep the existing
layers, and prefer deleting code over adding abstractions.

## Stack

| Layer | Choice |
|---|---|
| UI/API | Next.js 16 App Router, React 19, TypeScript |
| Database | SQLite through Node's built-in `node:sqlite` |
| Storage | Local filesystem; `Public/` and `Private/<username>/` |
| Video | `ffmpeg`/`ffprobe`, direct HTTP ranges, HLS for unsupported formats |
| Images | `sharp` + ImageMagick fallback (HEIC/TIFF) |
| PDF | `pdfjs-dist` with assets under `public/pdfjs/` |
| Auth | bcrypt, hashed session tokens, optional TOTP |
| TLS | Caddy on 3000 with a static local-CA certificate |
| Archives | `yazl` ZIP streaming |
| QR | `qrcode` |

## Local development

```bash
npm install
cp .env.example .env.local
```

For dev over HTTP:

```ini
COOKIE_SECURE=0
TRUST_PROXY=0
```

Run:

```bash
npm run dev       # http://127.0.0.1:3101
npm run typecheck
npm run build
```

`npm run start` listens on `127.0.0.1:3100`, matching the production unit. Port
3000 belongs to Caddy; do not start Next there. The dev server uses a separate
origin and does not go through Caddy, so HTTPS-specific behavior must be tested
against the live service.

## Layout

```
app/
  page.tsx, files/, login/, admin/, security/, trash/   pages
  api/auth/          login, logout, password, 2FA
  api/files/         list, create, rename, move, delete
  api/upload/        chunked uploads
  api/stream/        range streaming and downloads
  api/hls/           HLS playlist/segments and transcode starts
  api/media/         media metadata
  api/thumb/, preview/   thumbnails and HEIC previews
  api/zip/            streamed ZIP downloads
  api/trash/, favorites/, recent/, watch/, search/, home/
  api/admin/          users, stats, audit, cleanup, hotspot
components/
  FileBrowser.tsx    file list, uploads, bulk actions
  Viewer.tsx         chooses a viewer by file kind
  VideoPlayer.tsx    custom player, HLS, resume
  PhotoViewer.tsx    zoom/pan/slideshow
  PdfViewer.tsx      PDF.js canvas viewer
  AdminPanel.tsx     users, dashboard, hotspot
  SecurityPanel.tsx  password and 2FA
lib/
  auth.ts, security.ts, loginGuard.ts, totp.ts, audit.ts
  paths.ts           virtual Public/Private paths + traversal/symlink guard
  transcode.ts       HLS queue
  media.ts           ffprobe/ffmpeg helpers
  cleanup.ts, trash.ts, usage.ts, limits.ts
deploy/
  Caddyfile          TLS + HTTP redirect + reverse proxy
  issue-cert.sh      static cert from Caddy's local CA
  systemd-user/      fileshare, cove-caddy, backup timer
scripts/
  deploy.sh, backup.sh, hotspot.sh, install-hotspot.sh, tailscale-setup.sh
```

## Request flow

- Caddy handles TLS on 3000 and proxies to Next on `127.0.0.1:3100`.
- Caddy's `http_redirect` listener wrapper returns `308 https://…` for plain
  HTTP on the TLS port.
- Auth is checked in route handlers and pages. Every mutation also checks
  `Origin`/`Sec-Fetch-Site` via `originOk`.
- `resolveUserPath` maps virtual paths (`public/...`, `private/...`) to disk and
  rejects traversal and symlink escapes. Do not bypass it.
- Streaming uses HTTP range requests. Unsupported video formats start an HLS
  job; the client polls for readiness and plays the generated playlist.
- Uploads are chunked; the server assembles and validates the final file.
- SQLite migrations are additive `ensureColumn` calls in `lib/db.ts`; keep the
  schema backward compatible.

## Data model

`data/app.db` contains users, sessions, favorites, watch progress, audit log and
login throttle. `data/` also holds in-progress uploads, thumbnails, HLS cache and
trash. The filesystem is the source of truth for file listings.

The app assumes a single instance and a local disk. Do not point multiple app
processes at the same SQLite file without adding a locking/coordination layer.

## Security rules for changes

- Validate at trust boundaries: paths, uploads, ZIP output, media filenames,
  usernames and passwords.
- Keep private paths scoped to the caller's username; never accept a private
  path from another user.
- Serve active content (SVG/HTML/XML/JS/CSS) as downloads, not inline.
- Do not add a general shell/root helper. The hotspot helper is deliberately
  narrow.
- Keep secrets out of the repo; `.env.local`, `data/` and the CA are ignored.
- New mutations need auth, space checks and CSRF/origin checks.
- Do not add a dependency for a few lines; use the standard library or an
  existing package.

## Verification

There is no automated browser test suite. Before shipping:

```bash
npm run typecheck
npm run build
npm audit
```

Then check the affected flows against the live TLS service:

- sign in and session persistence;
- Public and Private browsing;
- upload, pause/resume, move, rename, delete and restore;
- ZIP download;
- direct video and HLS playback with seek;
- photo, PDF, audio and text previews;
- admin user create/reset/disable and audit entries;
- HTTP → HTTPS redirect;
- certificate validation for the current LAN and Tailscale names.

After rebuilding, use `./scripts/deploy.sh`; Next needs a restart to pick up a new
build. Certificate changes use `./deploy/issue-cert.sh`.
