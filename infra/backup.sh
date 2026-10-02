#!/usr/bin/env bash
# Consistent online backup of the Stoliki SQLite DB (VACUUM INTO via the server binary).
#   infra/backup.sh                 -> /data/backups/stoliki-<timestamp>.db inside the volume,
#                                      plus a copy in $BACKUP_DIR (default ~/stoliki-backups)
# Copies leave the Pi by whatever means you normally use (scp, rsync, Syncthing...).
# Cron example (daily 03:15):  15 3 * * * /home/wojtekrpi/Claude-Code/stoliki/infra/backup.sh >>/tmp/stoliki-backup.log 2>&1
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "$HERE/compose.yml")
BACKUP_DIR="${BACKUP_DIR:-$HOME/stoliki-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"          # host copies older than this are pruned
NAME="stoliki-$(date +%F-%H%M%S).db"

"${COMPOSE[@]}" exec -T stoliki /app/server backup "/data/backups/$NAME"

umask 077   # backups hold guest names: owner-only
mkdir -p "$BACKUP_DIR"
"${COMPOSE[@]}" cp "stoliki:/data/backups/$NAME" "$BACKUP_DIR/$NAME"
find "$BACKUP_DIR" -maxdepth 1 -name 'stoliki-*.db' -mtime "+$KEEP_DAYS" -delete
chmod 600 "$BACKUP_DIR/$NAME"
echo "host copy: $BACKUP_DIR/$NAME"
