-- Co-partition `workflow_step_completions` by RANGE("deliveryCreatedAt") — delivery-graph
-- Phase 2. This N:1 child grows with deliveries, so partitioning lets retention DROP its
-- old months (O(1)) instead of an O(rows) cascade-DELETE when an aged `deliveries` month
-- is pruned. Composite PK (id, "deliveryCreatedAt"); the existing composite FK to the
-- partitioned `deliveries` is dropped before the swap and re-added after. Mirrors the
-- deliveries copy-swap (20260619140000). ONE transaction (Prisma wraps it).
--
-- The @@unique([deliveryId, workflowId, stepId]) MUST absorb the partition key (a
-- partitioned unique can't omit it) → ([deliveryId, workflowId, stepId, deliveryCreatedAt]);
-- semantically a no-op (one deliveryCreatedAt per delivery). Prisma truncates the index
-- name to 63 chars: "..._stepId_deli_key" — that exact literal keeps migrate-diff clean.

-- 1. Drop the Phase-1 composite FK to deliveries (can't swap a table that still has it).
ALTER TABLE "workflow_step_completions" DROP CONSTRAINT "workflow_step_completions_deliveryId_deliveryCreatedAt_fkey";

-- 2. Drop the old 3-column unique (replaced by the 4-column one that includes the part key).
DROP INDEX "workflow_step_completions_deliveryId_workflowId_stepId_key";

-- 3. Park the old table + free the PK name the partitioned parent reclaims.
ALTER TABLE "workflow_step_completions" RENAME TO "workflow_step_completions_old";
ALTER TABLE "workflow_step_completions_old" RENAME CONSTRAINT "workflow_step_completions_pkey" TO "workflow_step_completions_old_pkey";

-- 4. Partitioned parent. LIKE (never an explicit column list) — Phase 1 appended
--    deliveryCreatedAt LAST, so the column order is identical and INSERT SELECT * is safe.
CREATE TABLE "workflow_step_completions" (
  LIKE "workflow_step_completions_old" INCLUDING DEFAULTS,
  CONSTRAINT "workflow_step_completions_pkey" PRIMARY KEY ("id", "deliveryCreatedAt")
) PARTITION BY RANGE ("deliveryCreatedAt");

-- 5. The 4-column unique under the EXACT Prisma-truncated name (verified via migrate diff).
CREATE UNIQUE INDEX "workflow_step_completions_deliveryId_workflowId_stepId_deli_key"
  ON "workflow_step_completions" ("deliveryId", "workflowId", "stepId", "deliveryCreatedAt");

CREATE TABLE "workflow_step_completions_default" PARTITION OF "workflow_step_completions" DEFAULT;

-- 6. Orphan guard (empty at dev scale; prevents a scale-time FK-revalidation abort): drop
--    any old row whose (deliveryId, deliveryCreatedAt) no longer resolves to a delivery.
DELETE FROM "workflow_step_completions_old" c
  WHERE NOT EXISTS (
    SELECT 1 FROM "deliveries" d
    WHERE d."id" = c."deliveryId" AND d."createdAt" = c."deliveryCreatedAt"
  );

-- 7. Backfill through the DEFAULT, sort into monthly children, provision the forward window.
INSERT INTO "workflow_step_completions" SELECT * FROM "workflow_step_completions_old";
SELECT partition_drain_default('workflow_step_completions');
SELECT partition_ensure('workflow_step_completions', 3);
DROP TABLE "workflow_step_completions_old";

-- 8. Re-add the composite FK (under the Phase-1 name; propagates to every child partition).
ALTER TABLE "workflow_step_completions" ADD CONSTRAINT "workflow_step_completions_deliveryId_deliveryCreatedAt_fkey"
  FOREIGN KEY ("deliveryId", "deliveryCreatedAt") REFERENCES "deliveries"("id", "createdAt") ON DELETE CASCADE ON UPDATE CASCADE;
