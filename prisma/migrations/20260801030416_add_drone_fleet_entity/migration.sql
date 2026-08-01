-- CreateEnum
CREATE TYPE "DroneStatus" AS ENUM ('AVAILABLE', 'IN_FLIGHT', 'CHARGING', 'MAINTENANCE', 'GROUNDED');

-- CreateTable
CREATE TABLE "drones" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "firmwareVersion" TEXT,
    "status" "DroneStatus" NOT NULL DEFAULT 'AVAILABLE',
    "airworthy" BOOLEAN NOT NULL DEFAULT true,
    "maxPayloadKg" DOUBLE PRECISION NOT NULL,
    "batteryPercent" INTEGER NOT NULL DEFAULT 100,
    "homeBaseLat" DOUBLE PRECISION NOT NULL,
    "homeBaseLng" DOUBLE PRECISION NOT NULL,
    "currentLat" DOUBLE PRECISION,
    "currentLng" DOUBLE PRECISION,
    "flightHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "flightCycles" INTEGER NOT NULL DEFAULT 0,
    "maintenanceDueAt" TIMESTAMP(3),
    "ingestKeyHash" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "activeDeliveryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drones_serial_key" ON "drones"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "drones_ingestKeyHash_key" ON "drones"("ingestKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "drones_activeDeliveryId_key" ON "drones"("activeDeliveryId");

-- CreateIndex
CREATE INDEX "drones_status_airworthy_idx" ON "drones"("status", "airworthy");

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL BEFORE THE FOREIGN KEY.
--
-- `deliveries.assignedDroneId` has always been an unconstrained string holding
-- `drone-<uuid>` values that reference nothing. Adding the FK below against a
-- POPULATED table would fail on every one of them, so materialise an aircraft row
-- for each distinct id first.
--
-- Backfilled airframes are deliberately GROUNDED and not airworthy: we know their id
-- and nothing else — no serial, payload class, battery or home base — and dispatch
-- must never auto-claim an aircraft whose capabilities are unknown. An operator
-- registers them properly, which is the point of the table existing.
--
-- maxPayloadKg 0 and homeBase 0,0 are NOT NULL placeholders chosen to be obviously
-- unusable rather than plausibly wrong: a 0 kg payload matches no package.
INSERT INTO "drones" (
  "id", "serial", "model", "status", "airworthy",
  "maxPayloadKg", "homeBaseLat", "homeBaseLng", "createdAt", "updatedAt"
)
SELECT DISTINCT
  d."assignedDroneId",
  'BACKFILL-' || d."assignedDroneId",
  'UNKNOWN (backfilled)',
  'GROUNDED'::"DroneStatus",
  false,
  0, 0, 0, NOW(), NOW()
FROM "deliveries" d
WHERE d."assignedDroneId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- Re-establish the in-flight claim so the new unique constraint reflects reality.
-- DISTINCT ON guards the (not expected, but unenforced until now) case of one id
-- appearing on two live deliveries — the unique index would reject the second.
UPDATE "drones" dr
SET "activeDeliveryId" = pick."id", "status" = 'IN_FLIGHT'::"DroneStatus"
FROM (
  SELECT DISTINCT ON (d."assignedDroneId") d."assignedDroneId" AS drone_id, d."id"
  FROM "deliveries" d
  WHERE d."assignedDroneId" IS NOT NULL
    AND d."status" IN (
      'DRONE_ASSIGNED', 'PICKUP_IN_PROGRESS', 'IN_TRANSIT',
      'AWAITING_HANDOFF', 'RETURNING'
    )
  ORDER BY d."assignedDroneId", d."createdAt" DESC
) AS pick
WHERE dr."id" = pick.drone_id;
-- ─────────────────────────────────────────────────────────────────────────────

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_assignedDroneId_fkey" FOREIGN KEY ("assignedDroneId") REFERENCES "drones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
