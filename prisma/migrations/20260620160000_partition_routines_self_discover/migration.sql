-- Generalize the partition_* routines to SELF-DISCOVER each table's partition column,
-- so they work for `workflow_step_completions` / `drone_commands` (partitioned by
-- "deliveryCreatedAt") as well as `notifications` / `deliveries` (partitioned by
-- "createdAt") — the delivery-graph Phase 2 co-partitions the two N:1 children.
--
-- Until now the routines hard-coded the literal "createdAt". That is WRONG for the
-- children (their partition key is "deliveryCreatedAt"), and actively DANGEROUS for
-- drone_commands, which has BOTH a "createdAt" audit column AND the "deliveryCreatedAt"
-- partition key — the unfixed partition_drop_old would DELETE the wrong month.
--
-- The partition column is read from the catalog (pg_partitioned_table.partattrs[0] →
-- attname; int2vector is 0-based) on the PARTITIONED PARENT. CREATE OR REPLACE only →
-- no Prisma schema/migrate drift (functions aren't modelled by Prisma).

-- attach_month: carries forward the LOCKED body (20260616121000_partition_attach_lock —
-- the SHARE ROW EXCLUSIVE lock that closes the ATTACH-vs-live-insert race; do NOT regress
-- to the unlocked 20260616120000 body), now with the partition column self-discovered.
CREATE OR REPLACE FUNCTION partition_attach_month(p_table text, p_month date)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_child text := p_table || '_y' || to_char(p_month, 'YYYY') || 'm' || to_char(p_month, 'MM');
  v_hi    date := (p_month + INTERVAL '1 month')::date;
  v_col   text;
BEGIN
  IF to_regclass('public.' || quote_ident(v_child)) IS NOT NULL THEN
    RETURN false; -- already exists
  END IF;
  -- Discover the partition key on the PARENT (the LIKE child below is not yet partitioned).
  SELECT a.attname INTO v_col
  FROM pg_partitioned_table pt
  JOIN pg_class c ON c.oid = pt.partrelid
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = pt.partattrs[0]
  WHERE c.relname = p_table;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'partition_attach_month: % is not a partitioned table', p_table;
  END IF;
  EXECUTE format('CREATE TABLE %I (LIKE %I INCLUDING DEFAULTS)', v_child, p_table);
  -- Block concurrent inserts that would route to the DEFAULT for the DELETE→ATTACH
  -- window (conflicts with the insert path's ROW EXCLUSIVE, not with SELECT).
  EXECUTE format('LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE', p_table || '_default');
  EXECUTE format(
    'WITH moved AS (DELETE FROM %I WHERE %I >= %L AND %I < %L RETURNING *) '
    || 'INSERT INTO %I SELECT * FROM moved',
    p_table || '_default', v_col, p_month::timestamp, v_col, v_hi::timestamp, v_child
  );
  EXECUTE format(
    'ALTER TABLE %I ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)',
    p_table, v_child, p_month::timestamp, v_hi::timestamp
  );
  RETURN true;
END;
$$;

-- drain_default: relocate rows parked in the DEFAULT into proper monthly children,
-- grouping by the self-discovered partition column.
CREATE OR REPLACE FUNCTION partition_drain_default(p_table text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_created int := 0; v_m date; v_col text;
BEGIN
  IF to_regclass('public.' || quote_ident(p_table || '_default')) IS NULL THEN
    RETURN 0;
  END IF;
  SELECT a.attname INTO v_col
  FROM pg_partitioned_table pt
  JOIN pg_class c ON c.oid = pt.partrelid
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = pt.partattrs[0]
  WHERE c.relname = p_table;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'partition_drain_default: % is not a partitioned table', p_table;
  END IF;
  FOR v_m IN EXECUTE format(
    'SELECT DISTINCT date_trunc(''month'', %I)::date FROM %I',
    v_col, p_table || '_default'
  ) LOOP
    IF partition_attach_month(p_table, v_m) THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$$;

-- drop_old: retention. For a FK-REFERENCED parent (deliveries — inbound composite-FK
-- ON DELETE CASCADE from its children + registry) a leaf can't be bare-DROPped (schema
-- dependency), so DELETE the month's rows THROUGH the parent (fires the cascade) →
-- DETACH → DROP. For a leaf with NO inbound FK (notifications + the 2 co-partitioned
-- children) a bare DROP is correct AND O(1) — no row-by-row DELETE. The inbound-FK test
-- keys on confrelid = the PARTITIONED PARENT's oid (PG records the inbound dependency on
-- the parent, not the leaves). The month DELETE uses the SELF-DISCOVERED partition column
-- (mandatory: drone_commands' decoy "createdAt" audit column is NOT its partition key).
CREATE OR REPLACE FUNCTION partition_drop_old(p_table text, p_retain_months int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_dropped  int := 0;
  v_cutoff   date;
  v_m        date;
  v_col      text;
  v_has_refs boolean;
  r          record;
BEGIN
  IF p_retain_months IS NULL OR p_retain_months <= 0 THEN RETURN 0; END IF;
  v_cutoff := (date_trunc('month', now()) - make_interval(months => p_retain_months))::date;
  SELECT a.attname INTO v_col
  FROM pg_partitioned_table pt
  JOIN pg_class c ON c.oid = pt.partrelid
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = pt.partattrs[0]
  WHERE c.relname = p_table;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'partition_drop_old: % is not a partitioned table', p_table;
  END IF;
  v_has_refs := EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = (SELECT oid FROM pg_class WHERE relname = p_table AND relkind = 'p')
  );
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
      IF v_has_refs THEN
        -- Purge the month's rows through the parent so a composite ON DELETE CASCADE fans
        -- out to every referencing child; then the unreferenced leaf can detach + drop.
        -- At real scale this DELETE should be batched under a maintenance window.
        EXECUTE format(
          'DELETE FROM %I WHERE %I >= $1 AND %I < ($1 + interval ''1 month'')',
          p_table, v_col, v_col) USING v_m;
        EXECUTE format('ALTER TABLE %I DETACH PARTITION %I', p_table, r.child);
        EXECUTE format('DROP TABLE IF EXISTS %I', r.child);
      ELSE
        -- No inbound FK → an O(1) bare drop of the whole month partition.
        EXECUTE format('DROP TABLE IF EXISTS %I', r.child);
      END IF;
      v_dropped := v_dropped + 1;
    END IF;
  END LOOP;
  RETURN v_dropped;
END;
$$;
