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

  RAISE NOTICE 'ALL PARTITION CHECKS PASSED';
END $$;

ROLLBACK;
