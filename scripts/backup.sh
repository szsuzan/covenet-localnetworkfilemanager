#!/usr/bin/env bash
# Hardlink snapshot backup of Cove files + SQLite database.
# Set BACKUP_DEST to another disk for real protection.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${BACKUP_DEST:-}"
if [ -z "$DEST" ]; then
  echo "BACKUP_DEST is not set (example: /mnt/backup/Cove)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env.local"
set +a

STAMP="$(date +%Y-%m-%d_%H%M%S)"
FILES_DIR="$DEST/files"
DB_DIR="$DEST/db"
LATEST="$FILES_DIR/latest"
TARGET="$FILES_DIR/$STAMP"

mkdir -p "$FILES_DIR" "$DB_DIR"

if [ -d "$LATEST" ]; then
  rsync -a --link-dest="$LATEST" "$STORAGE_ROOT/" "$TARGET/"
else
  rsync -a "$STORAGE_ROOT/" "$TARGET/"
fi
ln -sfn "$TARGET" "$LATEST"

sqlite3 "$APP_DIR/data/app.db" ".backup '$DB_DIR/app-$STAMP.db.tmp'"
mv "$DB_DIR/app-$STAMP.db.tmp" "$DB_DIR/app-$STAMP.db"

# Keep the last 14 daily snapshots.
ls -1dt "$FILES_DIR"/20* 2>/dev/null | tail -n +15 | xargs -r rm -rf
ls -1t "$DB_DIR"/app-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f

date -Is > "$DEST/last-backup.txt"
echo "Backup complete: $TARGET"
