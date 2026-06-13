-- AlterEnum: exception outcomes — branches off the happy path, OUTSIDE STATUS_ORDER.
ALTER TYPE "DeliveryStatus" ADD VALUE 'RETURNING';
ALTER TYPE "DeliveryStatus" ADD VALUE 'DELIVERY_FAILED';
ALTER TYPE "DeliveryStatus" ADD VALUE 'RETURNED_TO_BASE';

-- CreateEnum: why a delivery failed/aborted (drives comms + the refund decision).
CREATE TYPE "DeliveryFailureReason" AS ENUM ('RECIPIENT_UNAVAILABLE', 'WEATHER_ABORT', 'UNSAFE_DROP_ZONE', 'MECHANICAL', 'ADMIN_ABORT', 'OTHER');

-- AlterTable: nullable — existing rows + the happy path stay NULL (no backfill).
ALTER TABLE "deliveries" ADD COLUMN "failureReason" "DeliveryFailureReason";
