#!/usr/bin/env bash
# backup.sh — take a verified, compressed, retained Postgres backup.
#
# Replaces the single `pg_dump > backup.sql` line that used to be the entire backup
# story: no compression, no retention, no integrity check, and — the part that
# actually matters — no restore procedure, so nobody knew whether the file was
# usable. A backup you have never restored is a hope, not a backup.
#
#   ./scripts/backup.sh                      # uses DATABASE_URL
#   BACKUP_DIR=/mnt/backups ./scripts/backup.sh
#   RETAIN_DAYS=30 ./scripts/backup.sh
#
# Exits non-zero on any failure so a cron/systemd timer surfaces it. Pair it with
# the DroveryBackupStale alert (see DEPLOY.md) — a silent backup failure is the
# same as no backup.
set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/drovery-${STAMP}.dump"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "backup.sh: DATABASE_URL is not set" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"

# -Fc (custom format): compressed, and restorable selectively with pg_restore.
# --no-owner/--no-privileges so a restore into a differently-named role works —
# which is exactly the situation you are in during an incident.
echo "backup.sh: dumping to ${OUT}"
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$OUT"

# VERIFY. pg_restore --list parses the archive's table of contents and fails on a
# truncated or corrupt dump, so a broken file is caught HERE rather than during the
# restore you are attempting at 3am.
if ! pg_restore --list "$OUT" >/dev/null 2>&1; then
  echo "backup.sh: FAILED verification — ${OUT} is not a readable archive" >&2
  rm -f "$OUT"
  exit 1
fi

TABLES="$(pg_restore --list "$OUT" | grep -c 'TABLE DATA' || true)"
BYTES="$(wc -c <"$OUT" | tr -d ' ')"
echo "backup.sh: ok — ${BYTES} bytes, ${TABLES} tables with data"

# A dump that verifies but contains no tables means we pointed at an empty or wrong
# database. Treat it as a failure rather than rotating a good backup out for it.
if [[ "$TABLES" -lt 1 ]]; then
  echo "backup.sh: FAILED — archive contains no table data" >&2
  exit 1
fi

# Retention runs LAST and only after a verified success, so a run of failures can
# never age out the last good backup.
if [[ "$RETAIN_DAYS" -gt 0 ]]; then
  DELETED="$(find "$BACKUP_DIR" -name 'drovery-*.dump' -type f -mtime "+${RETAIN_DAYS}" -print -delete | wc -l | tr -d ' ')"
  echo "backup.sh: retention ${RETAIN_DAYS}d — removed ${DELETED} old backup(s)"
fi

echo "$OUT"
