-- Harden partition_attach_month against an ATTACH-vs-live-insert race.
--
-- partition_attach_month builds the month child standalone, DELETEs the in-range rows
-- out of the DEFAULT, then ATTACHes (the ATTACH scans the DEFAULT to prove no row falls
-- in the new range). In steady state the child is pre-created MONTHS ahead while empty,
-- so the DEFAULT holds no in-range rows and the ATTACH is free. But in a maintenance-
-- lagged RECOVERY (the forward window lapsed, so the CURRENT month's child must be
-- attached while live inserts keep arriving), an INSERT could commit into the DEFAULT
-- between the DELETE and the ATTACH's default-scan → ATTACH fails, the tick rolls back,
-- and under sustained write load the child may never attach (rows pile in the DEFAULT;
-- drovery_partition_default_rows alerts, but auto-recovery wouldn't converge).
--
-- Fix: take a SHARE ROW EXCLUSIVE lock on the DEFAULT BEFORE the DELETE. It conflicts
-- with the INSERT path's ROW EXCLUSIVE (so no new in-range row can commit into the
-- DEFAULT during the window) but not with SELECT, and is held to statement/txn end
-- through the ATTACH's own ACCESS EXCLUSIVE acquisition. Because the DELETE runs AFTER
-- the lock is granted, any insert that committed while we waited is also drained — so
-- the DEFAULT has no in-range row at ATTACH time. No retry needed. The single-worker
-- scheduler means no maintenance-vs-maintenance contention, and writers never take
-- SHARE ROW EXCLUSIVE, so there is no deadlock with the insert path.
--
-- Function-body-only change (CREATE OR REPLACE) → no Prisma schema/migrate drift.

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
  -- Block concurrent inserts that would route to the DEFAULT for the DELETE→ATTACH
  -- window (conflicts with the insert path's ROW EXCLUSIVE, not with SELECT).
  EXECUTE format('LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE', p_table || '_default');
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
