-- CreateEnum
CREATE TYPE "TrackingSource" AS ENUM ('SIMULATED', 'LIVE');

-- AlterTable: a delivery is driven by the in-memory simulation (default) or by
-- real drone telemetry (LIVE, ingested via /ingest/telemetry). assignedDroneId
-- binds a LIVE delivery to its drone so a stranger gateway can't drive it.
ALTER TABLE "deliveries" ADD COLUMN "trackingSource" "TrackingSource" NOT NULL DEFAULT 'SIMULATED';
ALTER TABLE "deliveries" ADD COLUMN "assignedDroneId" TEXT;
