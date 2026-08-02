-- CreateEnum
CREATE TYPE "AdminAuditAction" AS ENUM ('DELIVERY_FORCE_CANCEL', 'DELIVERY_FAIL', 'DELIVERY_REFUND', 'DRONE_COMMAND_ISSUE', 'DRONE_CREATE', 'DRONE_UPDATE', 'PROMO_CREATE', 'PROMO_UPDATE', 'USER_ROLE_SET', 'SUPPORT_TICKET_REPLY', 'SUPPORT_TICKET_STATUS_SET');

-- CreateEnum
CREATE TYPE "AdminAuditTargetType" AS ENUM ('DELIVERY', 'DRONE', 'PROMO', 'USER', 'SUPPORT_TICKET');

-- Operator audit log, PARTITIONED FROM BIRTH by RANGE("createdAt").
--
-- Prisma generated a plain CREATE TABLE (it cannot express PARTITION BY); this is the
-- hand-written equivalent. See prisma/PARTITIONING.md.
--
-- Unlike every other partitioned child this one does NOT hang off `deliveries`: its
-- `targetId` is polymorphic (a delivery, a drone, a promo, a user, a ticket), so there
-- is no composite FK to add and its partition key is its own "createdAt".
--
-- Retention: this table sets retainMonths 0 explicitly in PARTITIONED_TABLES. It is
-- partitioned for the convention and for partition pruning on reads, NOT so that its
-- history can be dropped.

-- 1. The partitioned parent. Composite PK, id first, so a bare-id lookup still uses it.
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "action" "AdminAuditAction" NOT NULL,
    "targetType" "AdminAuditTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "args" JSONB,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id","createdAt")
) PARTITION BY RANGE ("createdAt");

-- 2. Indexes on the parent; PG propagates them to every partition, existing and future.
--    Names preserved exactly as Prisma generated them so the drift gate sees no diff.
CREATE INDEX "admin_audit_logs_actorUserId_createdAt_idx" ON "admin_audit_logs"("actorUserId", "createdAt");
CREATE INDEX "admin_audit_logs_targetType_targetId_createdAt_idx" ON "admin_audit_logs"("targetType", "targetId", "createdAt");
CREATE INDEX "admin_audit_logs_action_createdAt_idx" ON "admin_audit_logs"("action", "createdAt");

-- 3. The permanent catch-all, so an INSERT can never fail for want of a partition. An
--    audit write that fails now rolls back the operator action it was recording.
CREATE TABLE "admin_audit_logs_default" PARTITION OF "admin_audit_logs" DEFAULT;

-- 4. Provision the forward window now rather than waiting for the first maintenance run.
SELECT partition_ensure('admin_audit_logs', 3);
