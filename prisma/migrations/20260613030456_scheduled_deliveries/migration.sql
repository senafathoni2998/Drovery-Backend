-- AlterEnum
ALTER TYPE "DeliveryStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "scheduledFor" TIMESTAMP(3);
