# Cove security & functionality audit

Date: 2026-11-02  
Scope: application code, HTTP APIs, authentication, file handling, uploads,
archives, media processing, dependencies, system service, firewall and ports.

## Fixed during this audit

| Issue | Severity | Fix |
|---|---|---|
| Plain HTTP on port 3000; session cookie not `Secure` | High | Caddy serves HTTPS on 3000 with a local-CA certificate; Next moved to loopback `3100`; `COOKIE_SECURE=1`, `TRUST_PROXY=1`; plain HTTP returns a 308 redirect to HTTPS |
| Symlink inside a space could escape the storage root via a direct file URL | High | `resolveUserPath` now resolves the nearest real path and rejects anything outside the space (tested: `Public/leak.jpg → /etc/passwd` returns 400) |
| Client IP came from spoofable `X-Forwarded-For`, weakening login throttling and poisoning audit logs | High | Direct requests use `local`; production now sits behind Caddy with `TRUST_PROXY=1`, and Caddy overwrites `X-Forwarded-For` |
| HEIC/TIFF thumbnails returned 404; iPhone photos did not preview | Medium | ImageMagick fallback for thumbnails + cached `/api/preview` JPEG conversion |
| Browser back/forward did not work for folders/views | Medium | `pushState` + `popstate` navigation state |
| Fullscreen button failed on some browsers | Medium | Fullscreen API with iOS `webkitEnterFullscreen` fallback |
| HLS duration grew while transcoding | Medium | Full source duration from ffprobe; seek-ahead waits for the segment |
| PDF was a bare iframe; photo viewer lacked controls | UX | PDF.js page viewer and minimalist photo lightbox with zoom/pan/slideshow |
| Data directory and database were group/world-readable inside the home directory | Low | `data/` 700, `app.db` 600, `Backups/` 700, `.env.local` 600 |

Previously fixed and re-verified: stored XSS via SVG/HTML (now attachment +
`application/octet-stream`), ZIP symlink escape (walker skips symlinks), ZIP path
traversal, upload path traversal, CSRF via Origin/Sec-Fetch-Site.

## Verification performed

- Unauthenticated API calls: `401` on files, home, admin, thumbs, preview, zip, HLS.
- Normal user on admin APIs: `403`.
- `public/../Private/admin` and `../../etc`: rejected (`400`/`404`).
- Symlink pointing to `/etc/passwd`: rejected (`400`).
- ZIP containing a symlink to `/etc/passwd`: link omitted, real file included.
- Upload with `dir=public/../../etc`: rejected.
- Cross-site POST (`Origin: https://evil.example`): `403`.
- SVG served as `Content-Disposition: attachment`, `application/octet-stream`, `nosniff`.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- No private keys, credentials, API keys, GitHub tokens or cloud keys in tracked files.
- No `shell: true`, `execSync`, `spawnSync`, `eval`, or `new Function`.
- `child_process` usage: `execFile`/`spawn` with argument arrays and absolute,
  path-validated inputs (ffmpeg, ffprobe, ImageMagick, the hotspot helper).
- HTTPS on 3000 verifies with `public/cove-ca.crt` for `HOST.local`,
  `LAN-IP`, `10.42.0.1`, `TAILSCALE-IP` and
  `HOST.TAILNET.ts.net`; plain HTTP on 3000 returns `308` to the same URL over
  HTTPS; nothing listens externally on `3100`.
- Login over HTTPS sets `__Host-cove=…; Secure; HttpOnly; SameSite=lax`; the
  authenticated `/api/auth` and `/files` requests succeed; the probe user was
  removed afterwards.
- HTTP security headers present (CSP, nosniff, SAMEORIGIN, no-referrer,
  Permissions-Policy, COOP/CORP). HSTS is intentionally not enabled yet so
  clients are not locked out before they install the local CA.
- Photo viewer: HEIC preview 1800×2400, zoom, next, slideshow.
- PDF viewer: 2-page PDF rendered via PDF.js, page navigation, zoom, fullscreen.
- Video: direct MP4, MKV HLS, full duration, seek, speed, fullscreen, resume.
- No browser console errors in the tested flows.

## Remaining risks and required actions

### High

1. **SSH is still password-authenticated.** UFW now allows 22 only from the LAN
   and `tailscale0`; use SSH keys and disable password login before exposing the
   machine. The firewall commands are in
   [Operations](docs/OPERATIONS.md#firewall).
2. **The web app runs as the service user** with a NOPASSWD rule for the hotspot helper (and
   the existing Omarchy helper commands). A code-execution bug in Next.js,
   ffmpeg, ImageMagick or PDF.js handling could reach the user's home directory
   and Caddy's CA keys. It cannot gain root directly, but the blast radius is
   large. A dedicated `cove` service user with access only to `FileShare` +
   `data` would be safer.

### Medium

3. **Local CA onboarding / no HSTS yet.** New clients see a warning until they
   trust `public/cove-ca.crt`. HSTS is deliberately off until every client has
   the CA, so a warning-bypass cannot lock anyone out of the site.
4. **The TLS certificate is static.** It is valid for 397 days; re-run
   `./deploy/issue-cert.sh` after an IP change and before expiry.
5. **No malware scanning.** Uploaded files are stored as-is. The app never executes
   uploaded files, but ffmpeg/ffprobe/ImageMagick parse untrusted media as the service user.
   Keep those packages updated; optionally scan uploads with ClamAV.
6. **No per-user quota.** An authenticated user can fill the disk. There is a
   per-file limit (`MAX_UPLOAD_GB`, default 200 GB) but no account quota.
7. **Backups are on the same disk and unencrypted.** Point `BACKUP_DEST` at an
   external/NAS mount and preferably use restic/borg for encryption.
8. **CSP uses `'unsafe-inline'`** because Next.js injects inline bootstrap code.
   External scripts/objects are still blocked. A nonce-based CSP would be stronger.
9. **Private is application-level only.** Shell/root access to the machine can read
   `Private/<user>`, and admin password/2FA resets can access any account.
10. **Password minimum was lowered to 8 characters** (requested). Three character
    classes are still required, but this is below current best practice.

### Low

11. **HLS cache keys are shared by URL, not per-user.** A private transcode is
    reachable by anyone who knows its 160-bit SHA-1 key. Keys are unguessable in
    practice; a per-key owner check would be tighter.
12. **PDF viewer renders to canvas**, so text is not selectable and annotations are
    not editable. That is acceptable for a minimal previewer.
13. **HLS has one quality level**, no subtitle/audio-track selector. Seeking beyond
    the transcoded point waits for ffmpeg to catch up; direct MP4/WebM seeks instantly.
14. **The hotspot helper requires dnsmasq** and a one-time sudo setup. The DHCP
    interface rule (`67/udp on WIFI-INTERFACE`) was added and is present in UFW.

## Live state

As of 2026-11-02 22:15, the legacy system unit is not running and the current
build is running under the user-level units:

```bash
systemctl --user status fileshare cove-caddy --no-pager
ss -ltnp | grep -E ':3000|:3100'
curl -s --cacert public/cove-ca.crt -o /dev/null -w '%{http_code}\n' \
  https://127.0.0.1:3000/login
```

Caddy listens on `0.0.0.0:3000` (TLS); Next listens on `127.0.0.1:3100`.
`COOKIE_SECURE=1` and `TRUST_PROXY=1`. The certificate SANs and CA are refreshed
by `./deploy/issue-cert.sh`.
