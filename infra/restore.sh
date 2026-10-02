#!/usr/bin/env bash
# Restore a Stoliki backup into the named volume.  Usage: infra/restore.sh /path/to/stoliki-<date>.db
# Stops the app, keeps the current DB as stoliki.db.pre-restore-<ts>, writes the backup as
# /data/stoliki.db owned by the container's nonroot user (uid 65532), starts the app again.
#
# Restore drill without touching the live app: set STOLIKI_VOLUME to a scratch volume name
# (the app is then neither stopped nor started), e.g.
#   STOLIKI_VOLUME=stoliki-scratch infra/restore.sh ~/stoliki-backups/stoliki-2026-10-02.db
set -euo pipefail

SRC="${1:?usage: restore.sh <backup.db>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "$HERE/compose.yml")
VOLUME="${STOLIKI_VOLUME:-stoliki_stoliki-data}"   # <project>_<volume key> in compose.yml
HELPER_IMAGE="${HELPER_IMAGE:-alpine:3.22}"        # distroless has no shell/cp, so use a throwaway helper

[ -f "$SRC" ] || { echo "no such file: $SRC" >&2; exit 1; }
[ "$(head -c 15 "$SRC")" = "SQLite format 3" ] || { echo "not a SQLite database: $SRC" >&2; exit 1; }
SRC_ABS="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"

LIVE=0; [ -z "${STOLIKI_VOLUME:-}" ] && LIVE=1
[ "$LIVE" = 1 ] && "${COMPOSE[@]}" stop stoliki

docker run --rm --user 0 -v "$VOLUME":/data -v "$SRC_ABS":/restore/backup.db:ro "$HELPER_IMAGE" sh -euc '
  ts=$(date +%Y%m%d-%H%M%S)
  [ -f /data/stoliki.db ] && mv /data/stoliki.db "/data/stoliki.db.pre-restore-$ts"
  rm -f /data/stoliki.db-wal /data/stoliki.db-shm
  cp /restore/backup.db /data/stoliki.db
  chown 65532:65532 /data /data/stoliki.db
  chmod 640 /data/stoliki.db
'

[ "$LIVE" = 1 ] && "${COMPOSE[@]}" up -d stoliki
echo "restored $SRC into volume $VOLUME"
