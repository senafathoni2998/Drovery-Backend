-- Partition `notifications` by RANGE("createdAt") into monthly children + a DEFAULT.
--
-- Prisma cannot express partitioning, so this is a HAND-WRITTEN copy-swap migration
-- (precedent: 20260613231012_add_drone_commands/migration.sql). PostgreSQL cannot turn
-- a populated plain table into a partitioned one in place, so we rename the old table,
-- create a partitioned parent, backfill, and drop the old. The model PK is composite
-- `@@id([id, "createdAt"])` (id-first) because a RANGE-partitioned table requires the
-- partition key in every unique/PK; child DDL is owned by the `partition_*` routines +
-- the partition-maintenance scheduler, NOT Prisma. `prisma db push` is forbidden here
-- (deploy-only) — see prisma/PARTITIONING.md.
--
-- AT SCALE: this single-transaction rename→create→backfill→drop is correct for the
-- current (small) dataset. For a populated ~50M-row table, replace the one INSERT…SELECT
-- with a batched, month-by-month copy under a brief dual-write / maintenance window
-- (the partition_* routines are reused for that); see the runbook.

-- ── Generic partition-maintenance routines (table-parameterized; partition column is
-- "createdAt" for every Drovery partition target). Defined first so the backfill below
-- can use them, and CREATE OR REPLACE so the scheduler always runs the latest version.

-- Create + attach the monthly child for p_month if it is missing. Built standalone then
-- ATTACHed (not `CREATE ... PARTITION OF`) and any rows currently parked in the DEFAULT
-- for that month are relocated FIRST — so the ATTACH's default-constraint scan passes
-- (a bare `CREATE ... PARTITION OF` fails when the DEFAULT already holds in-range rows).
CREATE OR REPLACE FUNCTION partition_attach_month(p_table text, p_month date)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_child text := p_table || '_y' || to_char(p_month, 'YYYY') || 'm' || to_char(p_month, 'MM');
  v_hi    date := (p_month + INTERVAL '1 month')::date;
BEGIN
  IF to_regclass('public.' || quote_ident(v_child)) IS NOT NULL THEN
    RETURN false; -- already exists
  END IF;
  EXECUTE format('CREATE TABLE %I (LIKE %I INCLUDING DEFAULTS)', v_child, p_table);
  EXECUTE format(
    'WITH moved AS (DELETE FROM %I WHERE "createdAt" >= %L AND "createdAt" < %L RETURNING *) '
    || 'INSERT INTO %I SELECT * FROM moved',
    p_table || '_default', p_month::timestamp, v_hi::timestamp, v_child
  );
  EXECUTE format(
    'ALTER TABLE %I ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)',
    p_table, v_child, p_month::timestamp, v_hi::timestamp
  );
  RETURN true;
END;
$$;

-- Ensure the current month + the next N months each have a child partition.
CREATE OR REPLACE FUNCTION partition_ensure(p_table text, p_months_ahead int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_created int := 0; i int;
BEGIN
  FOR i IN 0..GREATEST(p_months_ahead, 0) LOOP
    IF partition_attach_month(
         p_table,
         (date_trunc('month', now()) + make_interval(months => i))::date
       ) THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$$;

-- Relocate any rows sitting in the DEFAULT into proper monthly children (creating them
-- as needed). Heals a maintenance lag AND is how the initial backfill below is sorted.
CREATE OR REPLACE FUNCTION partition_drain_default(p_table text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_created int := 0; v_m date;
BEGIN
  IF to_regclass('public.' || quote_ident(p_table || '_default')) IS NULL THEN
    RETURN 0;
  END IF;
  FOR v_m IN EXECUTE format(
    'SELECT DISTINCT date_trunc(''month'', "createdAt")::date FROM %I',
    p_table || '_default'
  ) LOOP
    IF partition_attach_month(p_table, v_m) THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$$;

-- Drop child partitions entirely older than the retention window (p_retain_months<=0
-- disables retention). The month is read from the child name (…_yYYYYmMM); the DEFAULT
-- partition is never matched. Production note: prefer DETACH PARTITION CONCURRENTLY +
-- archive before DROP — see the runbook.
CREATE OR REPLACE FUNCTION partition_drop_old(p_table text, p_retain_months int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_dropped int := 0; v_cutoff date; v_m date; r record;
BEGIN
  IF p_retain_months IS NULL OR p_retain_months <= 0 THEN RETURN 0; END IF;
  v_cutoff := (date_trunc('month', now()) - make_interval(months => p_retain_months))::date;
  FOR r IN
    SELECT c.relname AS child
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = p_table
      AND c.relname ~ ('^' || p_table || '_y[0-9]{4}m[0-9]{2}$')
  LOOP
    v_m := to_date(substring(r.child FROM '(y[0-9]{4}m[0-9]{2})$'), '"y"YYYY"m"MM');
    IF v_m < v_cutoff THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', r.child);
      v_dropped := v_dropped + 1;
    END IF;
  END LOOP;
  RETURN v_dropped;
END;
$$;

-- ── Copy-swap ────────────────────────────────────────────────────────────────────────

-- 1. Park the existing table; free the index/constraint names the new parent reclaims.
ALTER TABLE "notifications" RENAME TO "notifications_old";
ALTER TABLE "notifications_old" RENAME CONSTRAINT "notifications_pkey" TO "notifications_old_pkey";
ALTER INDEX "notifications_userId_read_idx" RENAME TO "notifications_old_userId_read_idx";
ALTER TABLE "notifications_old" DROP CONSTRAINT "notifications_userId_fkey";

-- 2. Partitioned parent — same columns/defaults as the old table (LIKE), composite PK
--    that includes the partition key, range-partitioned by month.
CREATE TABLE "notifications" (
  LIKE "notifications_old" INCLUDING DEFAULTS,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

-- 3. Recreate the index + FK with the exact Prisma-generated names (drift-clean). On a
--    partitioned table these are partitioned objects that propagate to every child.
CREATE INDEX "notifications_userId_read_idx" ON "notifications" ("userId", "read");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Permanent DEFAULT partition — catches ANY "createdAt" so an insert can NEVER fail
--    with "no partition found" even if maintenance lags; rows are drained out of it.
CREATE TABLE "notifications_default" PARTITION OF "notifications" DEFAULT;

-- 5. Backfill: all old rows land in the DEFAULT (no month children yet), then drain
--    sorts them into per-month children. Trivial in dev; batch this at scale.
INSERT INTO "notifications" SELECT * FROM "notifications_old";
SELECT partition_drain_default('notifications');

-- 6. Seed the forward window for new writes (current month + 3).
SELECT partition_ensure('notifications', 3);

-- 7. Drop the old table.
DROP TABLE "notifications_old";
