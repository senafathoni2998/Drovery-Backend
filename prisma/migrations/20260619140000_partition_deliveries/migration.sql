-- Partition `deliveries` by RANGE("createdAt") — the delivery-graph Phase 1.
--
-- The central table gets a composite PK (id,"createdAt"); since a Prisma relation must
-- reference the parent's full PK, every child gains a `deliveryCreatedAt` column + a
-- composite FK. Global trackingId uniqueness (which a partitioned table can't enforce)
-- moves to the non-partitioned `tracking_id_registry`. The partition_* plpgsql routines
-- already exist (from 20260616120000_partition_notifications); `deliveries` partitions on
-- "createdAt" — the literal those routines hardcode — so no generalization is needed.
--
-- ONE transaction (Prisma wraps it): an abort rolls back to the pre-migration plain table.
-- The child FK drops MUST precede the parent copy-swap (you can't swap a referenced table).
-- At dev scale the INSERT…SELECT backfills are trivial; for a populated table replace them
-- with a batched month-by-month copy under a maintenance window (see prisma/PARTITIONING.md).

-- 1. Global trackingId registry (non-partitioned) + backfill from the current deliveries.
CREATE TABLE "tracking_id_registry" (
  "trackingId"        TEXT NOT NULL,
  "deliveryId"        TEXT NOT NULL,
  "deliveryCreatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_id_registry_pkey" PRIMARY KEY ("trackingId")
);
CREATE UNIQUE INDEX "tracking_id_registry_deliveryId_key" ON "tracking_id_registry"("deliveryId");
CREATE UNIQUE INDEX "tracking_id_registry_deliveryId_deliveryCreatedAt_key" ON "tracking_id_registry"("deliveryId", "deliveryCreatedAt");
INSERT INTO "tracking_id_registry" ("trackingId", "deliveryId", "deliveryCreatedAt", "createdAt")
  SELECT "trackingId", "id", "createdAt", "createdAt" FROM "deliveries";

-- 2. Each child gains deliveryCreatedAt (backfilled from its parent, then NOT NULL). The
--    1:1 children additionally get the composite UNIQUE index that the composite relation
--    requires (the N:1 children — workflow_step_completions, drone_commands — do not).
ALTER TABLE "delivery_tracking" ADD COLUMN "deliveryCreatedAt" TIMESTAMP(3);
UPDATE "delivery_tracking" c SET "deliveryCreatedAt" = d."createdAt" FROM "deliveries" d WHERE d."id" = c."deliveryId";
ALTER TABLE "delivery_tracking" ALTER COLUMN "deliveryCreatedAt" SET NOT NULL;
CREATE UNIQUE INDEX "delivery_tracking_deliveryId_deliveryCreatedAt_key" ON "delivery_tracking"("deliveryId", "deliveryCreatedAt");

ALTER TABLE "payments" ADD COLUMN "deliveryCreatedAt" TIMESTAMP(3);
UPDATE "payments" c SET "deliveryCreatedAt" = d."createdAt" FROM "deliveries" d WHERE d."id" = c."deliveryId";
ALTER TABLE "payments" ALTER COLUMN "deliveryCreatedAt" SET NOT NULL;
CREATE UNIQUE INDEX "payments_deliveryId_deliveryCreatedAt_key" ON "payments"("deliveryId", "deliveryCreatedAt");

ALTER TABLE "proof_of_delivery" ADD COLUMN "deliveryCreatedAt" TIMESTAMP(3);
UPDATE "proof_of_delivery" c SET "deliveryCreatedAt" = d."createdAt" FROM "deliveries" d WHERE d."id" = c."deliveryId";
ALTER TABLE "proof_of_delivery" ALTER COLUMN "deliveryCreatedAt" SET NOT NULL;
CREATE UNIQUE INDEX "proof_of_delivery_deliveryId_deliveryCreatedAt_key" ON "proof_of_delivery"("deliveryId", "deliveryCreatedAt");

ALTER TABLE "delivery_ratings" ADD COLUMN "deliveryCreatedAt" TIMESTAMP(3);
UPDATE "delivery_ratings" c SET "deliveryCreatedAt" = d."createdAt" FROM "deliveries" d WHERE d."id" = c."deliveryId";
ALTER TABLE "delivery_ratings" ALTER COLUMN "deliveryCreatedAt" SET NOT NULL;
CREATE UNIQUE INDEX "delivery_ratings_deliveryId_deliveryCreatedAt_key" ON "delivery_ratings"("deliveryId", "deliveryCreatedAt");

ALTER TABLE "workflow_step_completions" ADD COLUMN "deliveryCreatedAt" TIMESTAMP(3);
UPDATE "workflow_step_completions" c SET "deliveryCreatedAt" = d."createdAt" FROM "deliveries" d WHERE d."id" = c."deliveryId";
ALTER TABLE "workflow_step_completions" ALTER COLUMN "deliveryCreatedAt" SET NOT NULL;

ALTER TABLE "drone_commands" ADD COLUMN "deliveryCreatedAt" TIMESTAMP(3);
UPDATE "drone_commands" c SET "deliveryCreatedAt" = d."createdAt" FROM "deliveries" d WHERE d."id" = c."deliveryId";
ALTER TABLE "drone_commands" ALTER COLUMN "deliveryCreatedAt" SET NOT NULL;

-- 3. Drop the child FKs to deliveries(id) so the parent can be swapped.
ALTER TABLE "delivery_tracking" DROP CONSTRAINT "delivery_tracking_deliveryId_fkey";
ALTER TABLE "payments" DROP CONSTRAINT "payments_deliveryId_fkey";
ALTER TABLE "proof_of_delivery" DROP CONSTRAINT "proof_of_delivery_deliveryId_fkey";
ALTER TABLE "delivery_ratings" DROP CONSTRAINT "delivery_ratings_deliveryId_fkey";
ALTER TABLE "workflow_step_completions" DROP CONSTRAINT "workflow_step_completions_deliveryId_fkey";
ALTER TABLE "drone_commands" DROP CONSTRAINT "drone_commands_deliveryId_fkey";

-- 4. Copy-swap `deliveries` → partitioned parent (mirrors the notifications migration).
ALTER TABLE "deliveries" RENAME TO "deliveries_old";
ALTER TABLE "deliveries_old" RENAME CONSTRAINT "deliveries_pkey" TO "deliveries_old_pkey";
ALTER INDEX "deliveries_userId_idx" RENAME TO "deliveries_old_userId_idx";
ALTER INDEX "deliveries_status_idx" RENAME TO "deliveries_old_status_idx";
ALTER INDEX "deliveries_trackingId_idx" RENAME TO "deliveries_old_trackingId_idx";
ALTER INDEX "deliveries_trackingId_key" RENAME TO "deliveries_old_trackingId_key";
ALTER TABLE "deliveries_old" DROP CONSTRAINT "deliveries_userId_fkey";

CREATE TABLE "deliveries" (
  LIKE "deliveries_old" INCLUDING DEFAULTS,
  CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

-- trackingId is now a PLAIN index (global uniqueness lives in the registry).
CREATE INDEX "deliveries_userId_idx" ON "deliveries" ("userId");
CREATE INDEX "deliveries_status_idx" ON "deliveries" ("status");
CREATE INDEX "deliveries_trackingId_idx" ON "deliveries" ("trackingId");
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "deliveries_default" PARTITION OF "deliveries" DEFAULT;

INSERT INTO "deliveries" SELECT * FROM "deliveries_old";
SELECT partition_drain_default('deliveries');
SELECT partition_ensure('deliveries', 3);

DROP TABLE "deliveries_old";

-- 5. Re-add each child's COMPOSITE FK to the partitioned parent's composite PK.
ALTER TABLE "delivery_tracking" ADD CONSTRAINT "delivery_tracking_deliveryId_deliveryCreatedAt_fkey"
  FOREIGN KEY ("deliveryId", "deliveryCreatedAt") REFERENCES "deliveries"("id", "createdAt") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_deliveryId_deliveryCreatedAt_fkey"
  FOREIGN KEY ("deliveryId", "deliveryCreatedAt") REFERENCES "deliveries"("id", "createdAt") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proof_of_delivery" ADD CONSTRAINT "proof_of_delivery_deliveryId_deliveryCreatedAt_fkey"
  FOREIGN KEY ("deliveryId", "deliveryCreatedAt") REFERENCES "deliveries"("id", "createdAt") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_deliveryId_deliveryCreatedAt_fkey"
  FOREIGN KEY ("deliveryId", "deliveryCreatedAt") REFERENCES "deliveries"("id", "createdAt") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_step_completions" ADD CONSTRAINT "workflow_step_completions_deliveryId_deliveryCreatedAt_fkey"
  FOREIGN KEY ("deliveryId", "deliveryCreatedAt") REFERENCES "deliveries"("id", "createdAt") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drone_commands" ADD CONSTRAINT "drone_commands_deliveryId_deliveryCreatedAt_fkey"
  FOREIGN KEY ("deliveryId", "deliveryCreatedAt") REFERENCES "deliveries"("id", "createdAt") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Registry → deliveries composite FK (created last, after the parent is partitioned).
ALTER TABLE "tracking_id_registry" ADD CONSTRAINT "tracking_id_registry_deliveryId_deliveryCreatedAt_fkey"
  FOREIGN KEY ("deliveryId", "deliveryCreatedAt") REFERENCES "deliveries"("id", "createdAt") ON DELETE CASCADE ON UPDATE CASCADE;
