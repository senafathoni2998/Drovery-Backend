-- verify-partitions.sql — proves the `notifications` time-range partitioning works,
-- WITHOUT needing data at scale. Non-destructive: everything runs in a transaction that
-- ROLLs BACK, so it can be run against the dev DB repeatedly.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-partitions.sql
--
-- Asserts: (1) notifications is RANGE-partitioned with a DEFAULT child; (2) a row routes
-- to the correct monthly child by "createdAt"; (3) an out-of-window row lands in the
-- DEFAULT and partition_ensure relocates it; (4) partition_drain_default heals a row
-- parked in the DEFAULT for a past month; (5) partition_drop_old removes a child older
-- than the retention window and never the DEFAULT. Any failed assertion aborts (RAISE).

\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_user      text := gen_random_uuid()::text;
  v_cur       date := date_trunc('month', now())::date;
  v_future    date := (date_trunc('month', now()) + INTERVAL '5 months')::date;
  v_past      date := (date_trunc('month', now()) - INTERVAL '2 months')::date;
  v_id        text;
  v_cid       text;
  v_loc       regclass;
  v_expected  text;
  v_default   bigint;
  v_dropped   int;
BEGIN
  -- 0. notifications must be a partitioned table (relkind 'p') with a DEFAULT child.
  IF (SELECT relkind FROM pg_class WHERE relname = 'notifications') <> 'p' THEN
    RAISE EXCEPTION 'FAIL: notifications is not partitioned';
  END IF;
  IF to_regclass('public.notifications_default') IS NULL THEN
    RAISE EXCEPTION 'FAIL: no DEFAULT partition';
  END IF;
  RAISE NOTICE 'OK 0: notifications is RANGE-partitioned + has a DEFAULT child';

  -- throwaway user (FK target); rolled back with everything else.
  INSERT INTO users (id, email, name, "passwordHash", "createdAt", "updatedAt")
  VALUES (v_user, v_user || '@verify.local', 'verify', 'x', now(), now());

  -- 1. Current-month row routes to this month's child (seeded by partition_ensure).
  v_id := gen_random_uuid()::text;
  INSERT INTO notifications (id, "userId", title, body, read, "createdAt")
  VALUES (v_id, v_user, 't', 'b', false, v_cur::timestamp + INTERVAL '1 day');
  SELECT tableoid::regclass INTO v_loc FROM notifications WHERE id = v_id;
  v_expected := 'notifications_y' || to_char(v_cur, 'YYYY') || 'm' || to_char(v_cur, 'MM');
  IF v_loc::text <> v_expected THEN
    RAISE EXCEPTION 'FAIL 1: current row in % (expected %)', v_loc, v_expected;
  END IF;
  RAISE NOTICE 'OK 1: current-month row routed to %', v_loc;

  -- 2. A row 5 months out (beyond the seeded window) lands in the DEFAULT.
  v_id := gen_random_uuid()::text;
  INSERT INTO notifications (id, "userId", title, body, read, "createdAt")
  VALUES (v_id, v_user, 't', 'b', false, v_future::timestamp + INTERVAL '2 days');
  SELECT tableoid::regclass INTO v_loc FROM notifications WHERE id = v_id;
  IF v_loc::text <> 'notifications_default' THEN
    RAISE EXCEPTION 'FAIL 2: out-of-window row in % (expected default)', v_loc;
  END IF;
  RAISE NOTICE 'OK 2: out-of-window row caught by the DEFAULT partition';

  -- 3. partition_ensure(6) creates the future child AND drains it out of the DEFAULT.
  PERFORM partition_ensure('notifications', 6);
  SELECT tableoid::regclass INTO v_loc FROM notifications WHERE id = v_id;
  v_expected := 'notifications_y' || to_char(v_future, 'YYYY') || 'm' || to_char(v_future, 'MM');
  IF v_loc::text <> v_expected THEN
    RAISE EXCEPTION 'FAIL 3: future row still in % after ensure (expected %)', v_loc, v_expected;
  END IF;
  RAISE NOTICE 'OK 3: partition_ensure relocated the future row to %', v_loc;

  -- 4. A past-month row lands in the DEFAULT, then partition_drain_default heals it.
  v_id := gen_random_uuid()::text;
  INSERT INTO notifications (id, "userId", title, body, read, "createdAt")
  VALUES (v_id, v_user, 't', 'b', false, v_past::timestamp + INTERVAL '3 days');
  SELECT tableoid::regclass INTO v_loc FROM notifications WHERE id = v_id;
  IF v_loc::text <> 'notifications_default' THEN
    RAISE EXCEPTION 'FAIL 4a: past row in % (expected default)', v_loc;
  END IF;
  PERFORM partition_drain_default('notifications');
  SELECT tableoid::regclass INTO v_loc FROM notifications WHERE id = v_id;
  v_expected := 'notifications_y' || to_char(v_past, 'YYYY') || 'm' || to_char(v_past, 'MM');
  IF v_loc::text <> v_expected THEN
    RAISE EXCEPTION 'FAIL 4b: past row still in % after drain (expected %)', v_loc, v_expected;
  END IF;
  SELECT count(*) INTO v_default FROM notifications_default;
  RAISE NOTICE 'OK 4: drain_default moved the past row to % (default now holds % rows)', v_loc, v_default;

  -- 5. partition_drop_old(retain=1) drops the 2-months-ago child, keeps the DEFAULT.
  v_dropped := partition_drop_old('notifications', 1);
  IF to_regclass('public.' || quote_ident(v_expected)) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 5: old child % was not dropped', v_expected;
  END IF;
  IF to_regclass('public.notifications_default') IS NULL THEN
    RAISE EXCEPTION 'FAIL 5: DEFAULT partition was wrongly dropped';
  END IF;
  RAISE NOTICE 'OK 5: drop_old removed % old child(ren) incl. %, DEFAULT preserved', v_dropped, v_expected;

  -- ── deliveries (delivery-graph Phase 1) ───────────────────────────────────────
  -- 6. deliveries is partitioned + has a DEFAULT; tracking_id_registry is plain.
  IF (SELECT relkind FROM pg_class WHERE relname = 'deliveries') <> 'p' THEN
    RAISE EXCEPTION 'FAIL 6: deliveries is not partitioned';
  END IF;
  IF to_regclass('public.deliveries_default') IS NULL THEN
    RAISE EXCEPTION 'FAIL 6: no deliveries DEFAULT partition';
  END IF;
  IF (SELECT relkind FROM pg_class WHERE relname = 'tracking_id_registry') <> 'r' THEN
    RAISE EXCEPTION 'FAIL 6: tracking_id_registry should be a plain table';
  END IF;
  RAISE NOTICE 'OK 6: deliveries RANGE-partitioned + DEFAULT; registry is plain';

  -- 7. A delivery routes to its month child; a child + registry row use the composite
  --    FK; deleting the delivery cascades them; and a duplicate trackingId is rejected.
  v_id := gen_random_uuid()::text; -- now() is the txn timestamp (stable across statements)
  INSERT INTO deliveries ("id","trackingId","userId","fromAddress","toAddress","receiver",
    "packages","packageSize","packageWeight","packageTypes","pickupDate","pickupTime",
    "estimatedPrice","createdAt","updatedAt")
    VALUES (v_id,'VERIFYAA',v_user,'A','B','R','box','S',1,'{}',now(),'10:00 AM',10,now(),now());
  INSERT INTO tracking_id_registry ("trackingId","deliveryId","deliveryCreatedAt") VALUES ('VERIFYAA', v_id, now());
  INSERT INTO payments ("id","deliveryId","deliveryCreatedAt","amount") VALUES (gen_random_uuid()::text, v_id, now(), 10);
  SELECT tableoid::regclass INTO v_loc FROM deliveries WHERE id = v_id;
  v_expected := 'deliveries_y' || to_char(now(), 'YYYY') || 'm' || to_char(now(), 'MM');
  IF v_loc::text <> v_expected THEN
    RAISE EXCEPTION 'FAIL 7a: delivery in % (expected %)', v_loc, v_expected;
  END IF;
  -- duplicate trackingId (valid deliveryId so only the registry PK conflicts) → rejected.
  BEGIN
    INSERT INTO tracking_id_registry ("trackingId","deliveryId","deliveryCreatedAt") VALUES ('VERIFYAA', v_id, now());
    RAISE EXCEPTION 'FAIL 7b: duplicate trackingId was NOT rejected';
  EXCEPTION WHEN unique_violation THEN NULL; -- expected
  END;
  -- composite-FK ON DELETE CASCADE (delete by id alone — scans partitions, but the
  -- stored timestamp(3) createdAt won't equal full-precision now(), so don't gate on it).
  DELETE FROM deliveries WHERE "id" = v_id;
  SELECT count(*) INTO v_default FROM payments WHERE "deliveryId" = v_id;
  IF v_default <> 0 THEN RAISE EXCEPTION 'FAIL 7c: payment child not cascaded (% left)', v_default; END IF;
  SELECT count(*) INTO v_default FROM tracking_id_registry WHERE "deliveryId" = v_id;
  IF v_default <> 0 THEN RAISE EXCEPTION 'FAIL 7c: registry row not cascaded'; END IF;
  RAISE NOTICE 'OK 7: delivery routed to %, trackingId dup rejected, composite-FK cascade clean', v_expected;

  -- 8. Retention on a FK-REFERENCED parent: partition_drop_old must cascade-drop an aged
  --    `deliveries` partition AND its composite-FK children/registry. The pre-cascade routine
  --    (bare DROP TABLE) failed here because every leaf carries the inbound-FK schema
  --    dependency — so retention silently reclaimed nothing. Build an aged (2020-01) leaf,
  --    populate it + a payment + a registry row, prune with retain=1, and assert the leaf
  --    AND its children are gone while the DEFAULT survives.
  CREATE TABLE IF NOT EXISTS deliveries_y2020m01 PARTITION OF deliveries
    FOR VALUES FROM ('2020-01-01') TO ('2020-02-01');
  v_id := gen_random_uuid()::text;
  INSERT INTO deliveries ("id","trackingId","userId","fromAddress","toAddress","receiver",
    "packages","packageSize","packageWeight","packageTypes","pickupDate","pickupTime",
    "estimatedPrice","createdAt","updatedAt")
    VALUES (v_id,'VERIFYOLD',v_user,'A','B','R','box','S',1,'{}','2020-01-15'::timestamp,
            '10:00 AM',10,'2020-01-15'::timestamp,'2020-01-15'::timestamp);
  INSERT INTO tracking_id_registry ("trackingId","deliveryId","deliveryCreatedAt")
    VALUES ('VERIFYOLD', v_id, '2020-01-15'::timestamp);
  INSERT INTO payments ("id","deliveryId","deliveryCreatedAt","amount")
    VALUES (gen_random_uuid()::text, v_id, '2020-01-15'::timestamp, 10);
  SELECT tableoid::regclass INTO v_loc FROM deliveries WHERE id = v_id;
  IF v_loc::text <> 'deliveries_y2020m01' THEN
    RAISE EXCEPTION 'FAIL 8a: aged delivery in % (expected deliveries_y2020m01)', v_loc;
  END IF;
  v_dropped := partition_drop_old('deliveries', 1);
  IF to_regclass('public.deliveries_y2020m01') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 8b: aged deliveries partition was NOT dropped (retention broken)';
  END IF;
  IF to_regclass('public.deliveries_default') IS NULL THEN
    RAISE EXCEPTION 'FAIL 8b: deliveries DEFAULT was wrongly dropped';
  END IF;
  SELECT count(*) INTO v_default FROM payments WHERE "deliveryId" = v_id;
  IF v_default <> 0 THEN
    RAISE EXCEPTION 'FAIL 8c: payment child not cascaded on partition drop (% left)', v_default;
  END IF;
  SELECT count(*) INTO v_default FROM tracking_id_registry WHERE "deliveryId" = v_id;
  IF v_default <> 0 THEN
    RAISE EXCEPTION 'FAIL 8c: registry row not cascaded on partition drop';
  END IF;
  RAISE NOTICE 'OK 8: drop_old cascade-dropped the aged deliveries partition (% incl. children+registry), DEFAULT preserved', v_dropped;

  -- ── delivery-graph Phase 2: co-partitioned N:1 children ───────────────────────
  -- 9. workflow_step_completions + drone_commands are RANGE("deliveryCreatedAt")-partitioned
  --    with a DEFAULT; the routines self-discover that column (NOT drone_commands' decoy
  --    "createdAt" audit column).
  IF (SELECT relkind FROM pg_class WHERE relname = 'workflow_step_completions') <> 'p'
     OR (SELECT relkind FROM pg_class WHERE relname = 'drone_commands') <> 'p' THEN
    RAISE EXCEPTION 'FAIL 9: a co-partitioned child is not partitioned';
  END IF;
  IF to_regclass('public.workflow_step_completions_default') IS NULL
     OR to_regclass('public.drone_commands_default') IS NULL THEN
    RAISE EXCEPTION 'FAIL 9: a co-partitioned child has no DEFAULT partition';
  END IF;
  IF (SELECT a.attname FROM pg_partitioned_table pt
        JOIN pg_class c ON c.oid = pt.partrelid
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = pt.partattrs[0]
      WHERE c.relname = 'drone_commands') <> 'deliveryCreatedAt' THEN
    RAISE EXCEPTION 'FAIL 9: drone_commands partition column mis-discovered (the decoy createdAt?)';
  END IF;
  RAISE NOTICE 'OK 9: both N:1 children RANGE(deliveryCreatedAt)-partitioned + DEFAULT; self-discover correct';

  -- 10. The one-open partial unique (now including the partition key) still rejects a 2nd
  --     OPEN command per delivery, and allows a non-open (EXPIRED) duplicate.
  v_id := gen_random_uuid()::text; -- a current-month delivery (trackingId is a plain index now)
  INSERT INTO deliveries ("id","trackingId","userId","fromAddress","toAddress","receiver",
    "packages","packageSize","packageWeight","packageTypes","pickupDate","pickupTime",
    "estimatedPrice","createdAt","updatedAt")
    VALUES (v_id,'VERIFYDC',v_user,'A','B','R','box','S',1,'{}',now(),'10:00 AM',10,now(),now());
  INSERT INTO drone_commands ("id","deliveryId","deliveryCreatedAt","droneId","type","reason","status","expiresAt","updatedAt")
    VALUES (gen_random_uuid()::text, v_id, now(), 'drone-x', 'RETURN_TO_BASE', 'WEATHER_ABORT', 'PENDING', now() + INTERVAL '1 hour', now());
  BEGIN
    INSERT INTO drone_commands ("id","deliveryId","deliveryCreatedAt","droneId","type","reason","status","expiresAt","updatedAt")
      VALUES (gen_random_uuid()::text, v_id, now(), 'drone-x', 'ABORT', 'ADMIN_ABORT', 'PENDING', now() + INTERVAL '1 hour', now());
    RAISE EXCEPTION 'FAIL 10: a 2nd OPEN command for the delivery was NOT rejected';
  EXCEPTION WHEN unique_violation THEN NULL; -- expected
  END;
  INSERT INTO drone_commands ("id","deliveryId","deliveryCreatedAt","droneId","type","reason","status","expiresAt","updatedAt")
    VALUES (gen_random_uuid()::text, v_id, now(), 'drone-x', 'ABORT', 'ADMIN_ABORT', 'EXPIRED', now() + INTERVAL '1 hour', now());
  RAISE NOTICE 'OK 10: one-open partial unique holds across the partition key (EXPIRED dup allowed)';

  -- 11. Retention end-to-end with the corrected ordering: a co-partitioned child's aged
  --     partition is BARE-dropped (no inbound FK → O(1), no DELETE/DETACH), keyed on
  --     deliveryCreatedAt (the command's audit createdAt is now() — a decoy); then the
  --     parent deliveries' aged partition cascade-drops. Children-before-parent order.
  CREATE TABLE IF NOT EXISTS deliveries_y2019m01 PARTITION OF deliveries
    FOR VALUES FROM ('2019-01-01') TO ('2019-02-01');
  CREATE TABLE IF NOT EXISTS drone_commands_y2019m01 PARTITION OF drone_commands
    FOR VALUES FROM ('2019-01-01') TO ('2019-02-01');
  v_id := gen_random_uuid()::text;
  INSERT INTO deliveries ("id","trackingId","userId","fromAddress","toAddress","receiver",
    "packages","packageSize","packageWeight","packageTypes","pickupDate","pickupTime",
    "estimatedPrice","createdAt","updatedAt")
    VALUES (v_id,'VERIFYAGED',v_user,'A','B','R','box','S',1,'{}','2019-01-15'::timestamp,
            '10:00 AM',10,'2019-01-15'::timestamp,'2019-01-15'::timestamp);
  v_cid := gen_random_uuid()::text;
  INSERT INTO drone_commands ("id","deliveryId","deliveryCreatedAt","droneId","type","reason","status","expiresAt","createdAt","updatedAt")
    VALUES (v_cid, v_id, '2019-01-15'::timestamp, 'drone-y', 'ABORT', 'ADMIN_ABORT', 'ACKED', now() + INTERVAL '1 hour', now(), now());
  SELECT tableoid::regclass INTO v_loc FROM drone_commands WHERE id = v_cid;
  IF v_loc::text <> 'drone_commands_y2019m01' THEN
    RAISE EXCEPTION 'FAIL 11a: aged command routed to % (expected drone_commands_y2019m01)', v_loc;
  END IF;
  v_dropped := partition_drop_old('drone_commands', 1);
  IF to_regclass('public.drone_commands_y2019m01') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 11b: aged drone_commands partition not bare-dropped (retention broken)';
  END IF;
  IF to_regclass('public.drone_commands_default') IS NULL THEN
    RAISE EXCEPTION 'FAIL 11b: drone_commands DEFAULT wrongly dropped';
  END IF;
  SELECT count(*) INTO v_default FROM drone_commands WHERE id = v_cid;
  IF v_default <> 0 THEN
    RAISE EXCEPTION 'FAIL 11b: aged command survived (drop keyed on the decoy createdAt?)';
  END IF;
  v_dropped := partition_drop_old('deliveries', 1);
  IF to_regclass('public.deliveries_y2019m01') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 11c: aged deliveries partition not dropped after children';
  END IF;
  SELECT count(*) INTO v_default FROM deliveries WHERE id = v_id;
  IF v_default <> 0 THEN RAISE EXCEPTION 'FAIL 11c: aged delivery survived'; END IF;
  RAISE NOTICE 'OK 11: child bare-DROP (O(1), keyed on deliveryCreatedAt) then parent cascade-drop — ordering clean';

  RAISE NOTICE 'ALL PARTITION CHECKS PASSED';
END $$;

ROLLBACK;
