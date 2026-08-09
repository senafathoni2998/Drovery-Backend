-- CreateEnum
CREATE TYPE "AirspaceZoneKind" AS ENUM ('AIRPORT', 'MILITARY', 'TEMPORARY', 'EVENT');

-- AlterEnum: new admin-audit actions for airspace zone management (used starting Task 4).
ALTER TYPE "AdminAuditAction" ADD VALUE 'AIRSPACE_ZONE_CREATE';
ALTER TYPE "AdminAuditAction" ADD VALUE 'AIRSPACE_ZONE_UPDATE';
ALTER TYPE "AdminAuditAction" ADD VALUE 'AIRSPACE_ZONE_DEACTIVATE';

-- AlterEnum
ALTER TYPE "AdminAuditTargetType" ADD VALUE 'AIRSPACE_ZONE';

-- CreateTable
CREATE TABLE "airspace_zones" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" "AirspaceZoneKind" NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL,
    "floorM" INTEGER,
    "ceilingM" INTEGER,
    "activeFrom" TIMESTAMP(3),
    "activeUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airspace_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "airspace_zones_active_idx" ON "airspace_zones"("active");

-- Seed the two zones that until now lived in serviceability.constants.ts.
--
-- This is load-bearing. Task 3 deletes that constant, and without these rows the
-- geometry would simply find no zones — the airspace this system protects would open
-- silently, with every test still green. Coordinates and radii are copied verbatim.
INSERT INTO "airspace_zones" ("id", "name", "kind", "lat", "lng", "radiusKm", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'Soekarno-Hatta International Airport', 'AIRPORT', -6.1256, 106.6558, 5, true, NOW(), NOW()),
  (gen_random_uuid(), 'Halim Perdanakusuma Airport',          'AIRPORT', -6.2647, 106.9308, 3, true, NOW(), NOW());
