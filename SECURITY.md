# Security model

Cove is designed for a **trusted private LAN** with a small number of known users.
It is not a public-internet service.

> **Current deployment: plain HTTP on port 3000.** TLS was disabled at the owner's
> request for now. Credentials, session cookies and file contents are **not encrypted
> in transit**. Anyone who can sniff the LAN can capture them. Treat the network as
> trusted and re-enable TLS before using this on Wi-Fi you do not control.

## What is protected

| Area | Control |
|---|---|
| Transport | Plain HTTP on port 3000 on the LAN (TLS disabled); Tailscale access is encrypted by WireGuard |
| Sessions | `HttpOnly`, `SameSite=Lax` cookie (not `Secure` in HTTP mode), SHA-256 token hashes, 30-day absolute + 7-day idle expiry, 10-session cap, revoke-all |
| Passwords | bcrypt cost 12, minimum 8 chars with 3 character classes, no username, small common-password blocklist, forced change of the seeded default |
| Login | Generic errors, dummy-hash timing equalisation, persisted throttling (10 per account+IP, 40 per IP per 15 min, 15-minute lock) |
| Second factor | Optional TOTP (SHA-1, 6 digits, 30 s, ±1 window), QR/secret setup, admin reset |
| CSRF | SameSite=Lax plus `Origin`/`Sec-Fetch-Site` validation on every mutation |
| Browser | CSP, nosniff, SAMEORIGIN framing, no-referrer, Permissions-Policy, COOP/CORP, no `X-Powered-By` |
| Files | Canonicalised paths inside the storage root, no symlinks, chunk and total-size caps |
| Stored XSS | SVG/HTML/XML/JS/CSS served as `application/octet-stream` with `Content-Disposition: attachment` |
| Archives | ZIP walker refuses symlinks, so it cannot follow links outside the space |
| Authorisation | Every API re-checks the session and per-space access; private paths map to the caller's own folder |
| Audit | Logins, failures, uploads, deletes/restores, admin changes, password and 2FA events |

## Residual risks (accepted)

1. **No transport encryption.** HTTP means passwords, session cookies and files can be
   read by anyone with access to the network path. This is the main accepted risk while
   TLS is disabled.
2. **Admin can reset passwords and 2FA**, and therefore can sign in as any user.
   This is inherent to a single-admin system; private folders are private from other
   *users*, not from the server operator.
3. **Shell/root access to the machine reads everything** under `STORAGE_ROOT`.
   Privacy is enforced by the app, not the OS.
4. **CSP allows `'unsafe-inline'` for scripts/styles** because Next.js injects inline
   bootstrap code. External scripts and objects are still blocked; all user content is
   escaped or forced to download.
5. **Files are not encrypted at rest.** Full-disk encryption is recommended.
6. **No malware scanning.** Uploads are stored as-is; do not run untrusted binaries.
7. **No per-folder ACLs.** Access is Public vs. your own Private space.
8. **The app is directly exposed on port 3000** while Caddy is disabled. Keep the UFW
   rule scoped to the LAN subnet.

## Re-enabling TLS

1. `sudo systemctl disable --now fileshare.service` (the current system unit)
2. Put a TLS site in `deploy/Caddyfile` for `https://LAN-IP:3000` with
   `tls internal` and `reverse_proxy 127.0.0.1:3100`.
3. Set `COOKIE_SECURE=1` in `.env.local` and rebuild.
4. `systemctl --user enable --now fileshare.service cove-caddy.service`
5. Trust `/cove-ca.crt` on every client.

HTTPS and HTTP cannot share one port, so plain `http://` will stop working when TLS
is enabled. That is the trade-off of using only port 3000.

## Operational checklist

- [ ] Keep this on a trusted LAN while TLS is disabled
- [ ] Enable 2FA for the admin account
- [ ] Point `BACKUP_DEST` at an external, ideally encrypted, destination
- [ ] Keep the OS, Node, ffmpeg and npm dependencies updated (`npm audit`)
- [ ] Do not expose port 3000 to the internet
- [ ] Review the audit log after adding users or changing roles
- [ ] Re-enable TLS when this leaves the trusted network

## Reporting

If you find a vulnerability, do not open a public issue with exploit details.
Contact the machine owner directly.
