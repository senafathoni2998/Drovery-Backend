-- AlterEnum
ALTER TYPE "DeliveryStatus" ADD VALUE 'AWAITING_HANDOFF';

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "handoffAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "handoffCodeHash" TEXT,
ADD COLUMN     "handoffConfirmedAt" TIMESTAMP(3);
