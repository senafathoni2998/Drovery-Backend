-- CreateEnum
CREATE TYPE "DroneCommandType" AS ENUM ('RETURN_TO_BASE', 'ABORT');

-- CreateEnum
CREATE TYPE "DroneCommandStatus" AS ENUM ('PENDING', 'FETCHED', 'ACKED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "drone_commands" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "droneId" TEXT NOT NULL,
    "type" "DroneCommandType" NOT NULL,
    "reason" "DeliveryFailureReason" NOT NULL,
    "status" "DroneCommandStatus" NOT NULL DEFAULT 'PENDING',
    "issuedByUserId" TEXT,
    "appliedTransition" BOOLEAN NOT NULL DEFAULT false,
    "resultNote" VARCHAR(200),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drone_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drone_commands_droneId_status_idx" ON "drone_commands"("droneId", "status");

-- CreateIndex
CREATE INDEX "drone_commands_deliveryId_idx" ON "drone_commands"("deliveryId");

-- AddForeignKey
ALTER TABLE "drone_commands" ADD CONSTRAINT "drone_commands_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drone_commands" ADD CONSTRAINT "drone_commands_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial UNIQUE index: at most ONE open (PENDING|FETCHED) command per delivery.
-- Prisma's schema can't express a WHERE-filtered unique, so it's hand-added here;
-- a concurrent/duplicate issue trips this → P2002 → the service maps it to 409.
CREATE UNIQUE INDEX "drone_commands_one_open_per_delivery" ON "drone_commands"("deliveryId") WHERE "status" IN ('PENDING', 'FETCHED');
