# CoveNet user guide

CoveNet is the private file and media server on this network. This guide is for
people who have an account. For server setup, see
[Operations](OPERATIONS.md); for admin tasks, see [Admin guide](ADMIN_GUIDE.md).

## Open CoveNet

Use the stable address:

```
https://HOST.local:3000
```

The IP address also works, for example `https://LAN-IP:3000`. Plain
`http://` links redirect to HTTPS automatically, so an old bookmark still works.

### First visit: trust the certificate

CoveNet uses a local certificate authority. The first visit shows a browser
warning. That is expected until the CoveNet CA is installed.

1. Continue to the login page.
2. Click **Install the CoveNet certificate**.
3. Install the downloaded `cove-ca.crt` as a trusted root/CA.
4. Reload the page; the warning should be gone.

See [Trust the CA](OPERATIONS.md#trust-the-ca-on-a-client) for platform-specific
steps. On a phone, this is a one-time setup per device.

## Sign in

1. Enter your username and password.
2. If 2FA is enabled, enter the six-digit authenticator code.
3. If the admin gave you a temporary password, CoveNet asks you to change it before
   you can open files.

New passwords must be at least 8 characters and use at least three of:
lowercase, uppercase, numbers, symbols.

## The interface

The left sidebar (or bottom navigation on a phone) has:

| Section | What it shows |
|---|---|
| **Home** | A public overview with recent videos, albums and folders |
| **Recent** | Files uploaded recently |
| **Favorites** | Files and folders you have starred |
| **Public** | Files every signed-in user can see |
| **Private** | Your own folder; other users cannot see it |
| **Trash** | Deleted items waiting to be restored or purged |

The top bar has search, the grid/list switch, sort order, upload controls and
your account menu. Search matches file and folder names inside Public and your
own Private space.

### Views and sorting

- Use the grid/list buttons to change the layout.
- Use the sort menu to sort by name, date or size.
- Breadcrumbs at the top show where you are; click a crumb to go back.
- Browser back/forward move through folders normally.

## Public and Private spaces

- **Public** is shared with every signed-in account. Anyone who can upload can
  add files or folders there.
- **Private** belongs to you. Other users cannot browse it, and the admin UI does
  not provide a file browser for it.
- The admin can still reset passwords, so privacy is enforced by the application,
  not by the operating system. See [Security](../SECURITY.md).

## Upload files

Uploads require the **upload** permission on your account. If the Upload button
is missing, ask the admin to enable it.

Ways to upload:

- **Upload** — choose one or more files.
- **Upload folder** — choose a folder; its structure is preserved.
- **Camera** — take a photo or record a video on a phone.
- **Drag and drop** files or folders onto the file list.
- **Drop to Public** — dropping on the Public home screen uploads to the Public
  root.

Large uploads run in chunks. The uploads panel shows progress and lets you pause,
resume or cancel a transfer. You can leave the folder while an upload continues.

The maximum file size is configured by the admin (`MAX_UPLOAD_GB`). Ask the admin
if a large file is rejected.

## Organize files

- **New folder** creates a folder in the current location.
- **Rename** changes the name of one selected item.
- **Cut** marks items, then **Paste** moves them into the current folder.
- **Delete** moves items to Trash.
- Select multiple items with the checkboxes, then use **Download ZIP**, **Cut** or
  **Delete** in the selection bar.
- `Ctrl+A` selects everything on the page; `Esc` clears the selection.

Folder downloads are ZIP streams and are prepared on the fly. Very large folders
take longer to start.

## View and play files

Click a file to open the viewer.

| Type | What you can do |
|---|---|
| Video | Play/pause, seek, volume, playback speed, picture-in-picture, fullscreen, keyboard controls; resumes where you stopped |
| Photo | Zoom, pan, rotate, previous/next, slideshow |
| PDF | Page navigation, zoom, fullscreen |
| Audio | Play with standard browser controls |
| Text | Read the file in the browser |

MP4/WebM files play directly. MKV, HEVC, AVI and other formats are transcoded to
HLS on demand; the first play may take a moment while the server prepares
segments. Seeking ahead in a transcoded video waits for the next segment.

Other files download normally.

### Video shortcuts

The player uses the usual video controls. Keyboard shortcuts work while the
player is open; click the video first if the page has focus elsewhere.

## Favorites, recent and progress

- Click the star on a file or folder to add it to **Favorites**.
- **Recent** lists recently uploaded files.
- Video progress is saved per account and offered again on the next play. It is
  cleared automatically near the end of a video.

## Trash

Deleting a file moves it to **Trash**; it is not immediately destroyed.

- **Restore** puts the item back.
- **Delete** from Trash removes it permanently.
- **Empty trash** removes everything currently in Trash.
- Trash is purged automatically after 30 days (configurable by the admin).

Deleting an account archives that user's Private folder in Trash; their Public
files stay in Public.

## Account and security

Open your account menu → **Account security** to:

- change your password;
- enable or disable TOTP two-factor authentication;
- sign out all of your sessions.

Enabling 2FA shows a QR code and a secret. Scan it with an authenticator app, then
enter a six-digit code to finish. Keep a recovery path: if you lose the
authenticator, an admin must reset 2FA for you.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Focus search |
| `Ctrl+A` | Select all visible items |
| `Delete` | Move selected items to Trash |
| `Esc` | Close the viewer/dialog or clear selection |

## Phone and tablet

The layout switches to bottom navigation on narrow screens. Uploads from the
camera roll and the camera capture button work over HTTPS once the CoveNet CA is
trusted.

If a phone warns "no internet" while connected to the laptop hotspot, keep the
Wi-Fi connection and choose "stay connected"; CoveNet is local-only.

## Common problems

| Symptom | Fix |
|---|---|
| Certificate warning | Install `cove-ca.crt` as a trusted root/CA, then reload |
| Login does not stick | Make sure the address starts with `https://`; clear old `http://` tabs |
| `502 Bad Gateway` | Server-side issue; ask the admin to check the CoveNet services |
| `HOST.local` does not resolve | Use the current IP, or check that mDNS/multicast is allowed on the Wi-Fi |
| "Too many attempts" | Wait 15 minutes or ask the admin to clear the lockout |
| Upload button missing | Ask the admin to enable upload permission |

More server-side troubleshooting is in [Operations](OPERATIONS.md#troubleshooting).
