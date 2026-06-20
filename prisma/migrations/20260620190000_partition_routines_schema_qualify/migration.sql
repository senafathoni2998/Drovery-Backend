-- Harden the self-discovering partition routines against a same-named table in another
-- schema. The 20260620160000 versions looked tables up by UNQUALIFIED `relname`, so if a
-- second schema ever held a partitioned table of the same name (a staging/scratch/tenant
-- schema, a `?schema=` change, a leftover copy), the catalog subqueries would match >1 row:
-- the self-discover `SELECT … INTO` would silently pick one, and worse, drop_old's
-- `confrelid = (SELECT oid … WHERE relname=…)` scalar subquery would abort with "more than
-- one row returned by a subquery" — swallowed by the maintenance catch, disabling retention.
--
-- Fix: resolve the parent to a single oid via to_regclass('public.<name>') and key every
-- catalog lookup on that oid (partrelid / inhparent / confrelid). CREATE OR REPLACE only →
-- drift-neutral. Behaviour is otherwise identical to 20260620160000.

CREATE OR REPLACE FUNCTION partition_attach_month(p_table text, p_month date)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_child      text := p_table || '_y' || to_char(p_month, 'YYYY') || 'm' || to_char(p_month, 'MM');
  v_hi         date := (p_month + INTERVAL '1 month')::date;
  v_col        text;
  v_parent_oid oid  := to_regclass('public.' || quote_ident(p_table))::oid;
BEGIN
  IF to_regclass('public.' || quote_ident(v_child)) IS NOT NULL THEN
    RETURN false; -- already exists
  END IF;
  SELECT a.attname INTO v_col
  FROM pg_partitioned_table pt
  JOIN pg_attribute a ON a.attrelid = pt.partrelid AND a.attnum = pt.partattrs[0]
  WHERE pt.partrelid = v_parent_oid;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'partition_attach_month: % is not a partitioned table in public', p_table;
  END IF;
  EXECUTE format('CREATE TABLE %I (LIKE %I INCLUDING DEFAULTS)', v_child, p_table);
  -- Block concurrent inserts that would route to the DEFAULT for the DELETE→ATTACH window.
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

CREATE OR REPLACE FUNCTION partition_drain_default(p_table text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_created    int := 0;
  v_m          date;
  v_col        text;
  v_parent_oid oid := to_regclass('public.' || quote_ident(p_table))::oid;
BEGIN
  IF to_regclass('public.' || quote_ident(p_table || '_default')) IS NULL THEN
    RETURN 0;
  END IF;
  SELECT a.attname INTO v_col
  FROM pg_partitioned_table pt
  JOIN pg_attribute a ON a.attrelid = pt.partrelid AND a.attnum = pt.partattrs[0]
  WHERE pt.partrelid = v_parent_oid;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'partition_drain_default: % is not a partitioned table in public', p_table;
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

CREATE OR REPLACE FUNCTION partition_drop_old(p_table text, p_retain_months int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_dropped    int := 0;
  v_cutoff     date;
  v_m          date;
  v_col        text;
  v_has_refs   boolean;
  v_parent_oid oid := to_regclass('public.' || quote_ident(p_table))::oid;
  r            record;
BEGIN
  IF p_retain_months IS NULL OR p_retain_months <= 0 THEN RETURN 0; END IF;
  v_cutoff := (date_trunc('month', now()) - make_interval(months => p_retain_months))::date;
  SELECT a.attname INTO v_col
  FROM pg_partitioned_table pt
  JOIN pg_attribute a ON a.attrelid = pt.partrelid AND a.attnum = pt.partattrs[0]
  WHERE pt.partrelid = v_parent_oid;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'partition_drop_old: % is not a partitioned table in public', p_table;
  END IF;
  v_has_refs := EXISTS (
    SELECT 1 FROM pg_constraint WHERE contype = 'f' AND confrelid = v_parent_oid
  );
  FOR r IN
    SELECT c.relname AS child
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = v_parent_oid
      AND c.relname ~ ('^' || p_table || '_y[0-9]{4}m[0-9]{2}$')
  LOOP
    v_m := to_date(substring(r.child FROM '(y[0-9]{4}m[0-9]{2})$'), '"y"YYYY"m"MM');
    IF v_m < v_cutoff THEN
      IF v_has_refs THEN
        EXECUTE format(
          'DELETE FROM %I WHERE %I >= $1 AND %I < ($1 + interval ''1 month'')',
          p_table, v_col, v_col) USING v_m;
        EXECUTE format('ALTER TABLE %I DETACH PARTITION %I', p_table, r.child);
        EXECUTE format('DROP TABLE IF EXISTS %I', r.child);
      ELSE
        EXECUTE format('DROP TABLE IF EXISTS %I', r.child);
      END IF;
      v_dropped := v_dropped + 1;
    END IF;
  END LOOP;
  RETURN v_dropped;
END;
$$;
