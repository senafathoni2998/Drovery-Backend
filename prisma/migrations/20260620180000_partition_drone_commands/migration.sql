-- Co-partition `drone_commands` by RANGE("deliveryCreatedAt") — delivery-graph Phase 2.
-- Composite PK (id, "deliveryCreatedAt"); mirrors the workflow_step_completions swap.
-- Two wrinkles vs that table: (a) TWO outbound FKs (the composite FK to deliveries AND
-- the issuedByUserId → users ON DELETE SET NULL) must be dropped before the swap and
-- re-added after; (b) the one-open-command partial unique must absorb the partition key.
--
-- IMPORTANT: drone_commands has BOTH a "createdAt" audit column and the
-- "deliveryCreatedAt" partition key — only the latter is the RANGE key. ONE transaction.

-- 1. Drop both outbound FKs (can't swap a table with live FK constraints on it).
ALTER TABLE "drone_commands" DROP CONSTRAINT "drone_commands_deliveryId_deliveryCreatedAt_fkey";
ALTER TABLE "drone_commands" DROP CONSTRAINT "drone_commands_issuedByUserId_fkey";

-- 2. Drop the partial unique + both plain indexes (recreated on the partitioned parent).
DROP INDEX "drone_commands_one_open_per_delivery";
DROP INDEX "drone_commands_droneId_status_idx";
DROP INDEX "drone_commands_deliveryId_idx";

-- 3. Park the old table + free the PK name.
ALTER TABLE "drone_commands" RENAME TO "drone_commands_old";
ALTER TABLE "drone_commands_old" RENAME CONSTRAINT "drone_commands_pkey" TO "drone_commands_old_pkey";

-- 4. Partitioned parent. LIKE — deliveryCreatedAt was appended last in Phase 1 → INSERT
--    SELECT * is positionally safe.
CREATE TABLE "drone_commands" (
  LIKE "drone_commands_old" INCLUDING DEFAULTS,
  CONSTRAINT "drone_commands_pkey" PRIMARY KEY ("id", "deliveryCreatedAt")
) PARTITION BY RANGE ("deliveryCreatedAt");

-- 5. Recreate the two plain indexes + the one-open partial unique INCLUDING the partition
--    key (PG16 requires it; ≡ (deliveryId) since all of a delivery's commands share one
--    deliveryCreatedAt). Names preserved so Prisma sees no drift.
CREATE INDEX "drone_commands_droneId_status_idx" ON "drone_commands" ("droneId", "status");
CREATE INDEX "drone_commands_deliveryId_idx" ON "drone_commands" ("deliveryId");
CREATE UNIQUE INDEX "drone_commands_one_open_per_delivery"
  ON "drone_commands" ("deliveryId", "deliveryCreatedAt")
  WHERE "status" IN ('PENDING', 'FETCHED');

CREATE TABLE "drone_commands_default" PARTITION OF "drone_commands" DEFAULT;

-- 6. Orphan guard (empty at dev scale; prevents a scale-time FK-revalidation abort).
DELETE FROM "drone_commands_old" c
  WHERE NOT EXISTS (
    SELECT 1 FROM "deliveries" d
    WHERE d."id" = c."deliveryId" AND d."createdAt" = c."deliveryCreatedAt"
  );

-- 7. Backfill, sort, provision forward window, drop old.
INSERT INTO "drone_commands" SELECT * FROM "drone_commands_old";
SELECT partition_drain_default('drone_commands');
SELECT partition_ensure('drone_commands', 3);
DROP TABLE "drone_commands_old";

-- 8. Re-add both FKs under their prior names. The composite FK propagates per-partition;
--    issuedByUserId stays ON DELETE SET NULL (so deleting an admin never cascades away the
--    audit row) — supported on a partitioned referencing table (PG11+).
ALTER TABLE "drone_commands" ADD CONSTRAINT "drone_commands_deliveryId_deliveryCreatedAt_fkey"
  FOREIGN KEY ("deliveryId", "deliveryCreatedAt") REFERENCES "deliveries"("id", "createdAt") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drone_commands" ADD CONSTRAINT "drone_commands_issuedByUserId_fkey"
  FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
