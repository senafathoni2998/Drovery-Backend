-- Make partition retention safe for a parent that has INBOUND foreign keys.
--
-- `deliveries` is the first partitioned table with referencing children (6 children +
-- tracking_id_registry, all composite-FK ON DELETE CASCADE). The original
-- partition_drop_old (from 20260616120000_partition_notifications) issued a bare
-- `DROP TABLE <leaf>` — fine for `notifications` (zero referencers), but on `deliveries`
-- Postgres REFUSES it: every leaf partition carries a schema-level dependency from each
-- inbound FK constraint, so the drop fails (even on an emptied leaf). The maintenance
-- tick swallowed that as a WARN, so an operator who set PARTITION_RETAIN_MONTHS>0 got a
-- retention feature that silently reclaimed nothing while old partitions grew unbounded.
--
-- Empirically verified on PG16: the only sequence that works for a referenced parent is
--   DELETE month rows THROUGH the parent  (fires composite ON DELETE CASCADE to children)
--   -> ALTER TABLE … DETACH PARTITION      (PG blocks DETACH while child rows still ref it,
--                                           so this only succeeds once the rows are gone)
--   -> DROP TABLE                          (a detached leaf has no inbound-FK schema dep)
-- This is also correct for a childless parent (notifications): the DELETE is just a
-- row-purge of that month, then detach + drop. No schema (Prisma model) change → drift-neutral.
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
      -- 1. Purge the month's rows through the PARENT so a composite ON DELETE CASCADE fans
      --    out to every referencing child (deliveries' 6 children + tracking_id_registry);
      --    a plain row-purge for a childless parent (notifications). At real scale this
      --    DELETE should be batched under a maintenance window — see prisma/PARTITIONING.md.
      EXECUTE format(
        'DELETE FROM %I WHERE "createdAt" >= $1 AND "createdAt" < ($1 + interval ''1 month'')',
        p_table) USING v_m;
      -- 2. The leaf is now unreferenced → DETACH then DROP. A bare DROP can't run while the
      --    leaf carries the inbound-FK schema dependency; DETACH removes it from the parent
      --    (PG already refuses to DETACH a leaf whose rows are still referenced, so step 1
      --    is a hard precondition, not an optimization).
      EXECUTE format('ALTER TABLE %I DETACH PARTITION %I', p_table, r.child);
      EXECUTE format('DROP TABLE IF EXISTS %I', r.child);
      v_dropped := v_dropped + 1;
    END IF;
  END LOOP;
  RETURN v_dropped;
END;
$$;
