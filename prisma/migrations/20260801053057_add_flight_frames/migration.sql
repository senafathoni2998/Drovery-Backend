-- Append-only flight recorder, PARTITIONED FROM BIRTH by RANGE("deliveryCreatedAt").
--
-- Prisma generated a plain CREATE TABLE (it cannot express PARTITION BY); this is the
-- hand-written equivalent. Unlike drone_commands / workflow_step_completions there is no
-- swap to perform — the table has never existed, so there is nothing to drain and no FK
-- to drop and re-add. See prisma/PARTITIONING.md.
--
-- Why partitioned on day one: this is the highest-volume table in the system by a wide
-- margin — one row per telemetry tick, where every other delivery child is one row per
-- delivery or per operator action. Retention has to be able to bare-DROP an aged month in
-- O(1); an O(rows) cascade DELETE on a flight recorder is not a viable retention story.
--
-- NOTE: like drone_commands, this table has BOTH a "recordedAt" audit column and the
-- "deliveryCreatedAt" partition key. Only the latter is the RANGE key. The partition_*
-- routines self-discover the key from the catalog so they get this right — but a human
-- reading the model should not assume "the timestamp column" is the partition column.

-- 1. The partitioned parent. Composite PK, id first, so a bare-id lookup still uses it.
CREATE TABLE "flight_frames" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "deliveryCreatedAt" TIMESTAMP(3) NOT NULL,
    "droneId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "altitudeM" DOUBLE PRECISION,
    "batteryPercent" INTEGER,
    "airspeedKph" DOUBLE PRECISION,
    "phase" VARCHAR(32),
    "droneStatus" VARCHAR(120),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_frames_pkey" PRIMARY KEY ("id","deliveryCreatedAt")
) PARTITION BY RANGE ("deliveryCreatedAt");

-- 2. Indexes on the parent; PG propagates them to every partition, existing and future.
--    Names preserved exactly as Prisma generated them so the drift gate sees no diff.
CREATE INDEX "flight_frames_deliveryId_recordedAt_idx" ON "flight_frames"("deliveryId", "recordedAt");
CREATE INDEX "flight_frames_droneId_recordedAt_idx" ON "flight_frames"("droneId", "recordedAt");

-- 3. The permanent catch-all, so an INSERT can never fail for want of a partition — the
--    maintenance job drains it into the right month. A dropped frame is evidence lost.
CREATE TABLE "flight_frames_default" PARTITION OF "flight_frames" DEFAULT;

-- 4. Provision the forward window now rather than waiting for the first maintenance run,
--    so frames land in a real month partition from the first live flight.
SELECT partition_ensure('flight_frames', 3);

-- 5. The composite FK to the partitioned parent. PG propagates it to every partition of
--    `deliveries`. ON DELETE CASCADE matches every other delivery child.
ALTER TABLE "flight_frames" ADD CONSTRAINT "flight_frames_deliveryId_deliveryCreatedAt_fkey"
  FOREIGN KEY ("deliveryId", "deliveryCreatedAt") REFERENCES "deliveries"("id", "createdAt") ON DELETE CASCADE ON UPDATE CASCADE;
