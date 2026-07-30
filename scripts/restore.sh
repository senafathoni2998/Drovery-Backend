#!/usr/bin/env bash
# restore.sh — restore a backup.sh archive, with a rehearsal mode.
#
# The half nobody had. `pg_dump > backup.sql` was documented; restoring was not, so
# the recovery path had never been executed and its runtime was unknown. Run the
# rehearsal on a schedule — an untested restore is the most common way a backup
# strategy turns out to be imaginary.
#
#   # REHEARSAL (safe, default): restore into a scratch database, verify, drop it.
#   ./scripts/restore.sh backups/drovery-20260726T101500Z.dump
#
#   # REAL restore into an existing database. Refuses unless you mean it.
#   CONFIRM=i-understand-this-overwrites ./scripts/restore.sh backups/x.dump "$DATABASE_URL"
#
# PARTITIONING NOTE: `deliveries` and its co-partitioned children are RANGE-partitioned
# and the child DDL is owned by the partition_* routines, not Prisma (see
# prisma/PARTITIONING.md). A custom-format dump carries the parent, the children and
# the attachments, so a plain pg_restore reproduces them — do NOT run
# `prisma migrate deploy` into a freshly restored database expecting it to rebuild them.
set -Eeuo pipefail

ARCHIVE="${1:-}"
TARGET_URL="${2:-}"

if [[ -z "$ARCHIVE" ]]; then
  echo "usage: restore.sh <archive.dump> [target-database-url]" >&2
  exit 2
fi
if [[ ! -f "$ARCHIVE" ]]; then
  echo "restore.sh: no such archive: $ARCHIVE" >&2
  exit 2
fi

# The destructive guard is checked FIRST — before reading the archive, before
# touching the server. A refusal should be immediate and unambiguous, and should not
# depend on anything else having succeeded.
if [[ -n "$TARGET_URL" && "${CONFIRM:-}" != "i-understand-this-overwrites" ]]; then
  echo "restore.sh: refusing to overwrite ${TARGET_URL%%\?*}" >&2
  echo "            set CONFIRM=i-understand-this-overwrites to proceed" >&2
  exit 3
fi

# Then verify the archive, so a corrupt file is caught before any restore starts.
if ! pg_restore --list "$ARCHIVE" >/dev/null 2>&1; then
  echo "restore.sh: $ARCHIVE is not a readable archive" >&2
  exit 1
fi

started=$(date +%s)

if [[ -n "$TARGET_URL" ]]; then
  # ── REAL RESTORE ── (CONFIRM was already enforced above)
  echo "restore.sh: restoring into the TARGET database (destructive)"
  pg_restore --clean --if-exists --no-owner --no-privileges \
    --dbname="$TARGET_URL" "$ARCHIVE"
  echo "restore.sh: restore complete in $(( $(date +%s) - started ))s"
  exit 0
fi

# ── REHEARSAL ──
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "restore.sh: DATABASE_URL is not set (needed to reach the server)" >&2
  exit 2
fi

SCRATCH="drovery_restore_test_$(date -u +%Y%m%d%H%M%S)"
ADMIN_URL="${DATABASE_URL%/*}/postgres"
SCRATCH_URL="${DATABASE_URL%/*}/${SCRATCH}"

cleanup() {
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS \"$SCRATCH\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "restore.sh: rehearsal — creating scratch database ${SCRATCH}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$SCRATCH\";"

pg_restore --no-owner --no-privileges --dbname="$SCRATCH_URL" "$ARCHIVE"

# Prove the restore produced a usable database, not just an exit code of 0.
TABLES=$(psql "$SCRATCH_URL" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
DELIVERIES=$(psql "$SCRATCH_URL" -tAc "SELECT count(*) FROM deliveries;" 2>/dev/null || echo 'ERR')
USERS=$(psql "$SCRATCH_URL" -tAc "SELECT count(*) FROM users;" 2>/dev/null || echo 'ERR')
PARTS=$(psql "$SCRATCH_URL" -tAc \
  "SELECT count(*) FROM pg_inherits i JOIN pg_class p ON p.oid=i.inhparent WHERE p.relname='deliveries';" 2>/dev/null || echo 'ERR')

echo "restore.sh: rehearsal results"
echo "  public tables      : $TABLES"
echo "  users rows         : $USERS"
echo "  deliveries rows    : $DELIVERIES"
echo "  delivery partitions: $PARTS   (0 would mean the partitioning did NOT survive)"
echo "  elapsed            : $(( $(date +%s) - started ))s"

if [[ "$USERS" == "ERR" || "$DELIVERIES" == "ERR" || "$TABLES" -lt 10 ]]; then
  echo "restore.sh: REHEARSAL FAILED — the archive does not restore to a usable database" >&2
  exit 1
fi

echo "restore.sh: rehearsal PASSED (scratch database dropped)"
