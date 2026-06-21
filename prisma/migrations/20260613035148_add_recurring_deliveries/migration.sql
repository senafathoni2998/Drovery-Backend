-- CreateEnum
CREATE TYPE "RecurrenceFreq" AS ENUM ('DAILY', 'WEEKLY');

-- CreateTable
CREATE TABLE "recurring_deliveries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "freq" "RecurrenceFreq" NOT NULL,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "timeOfDay" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastMaterializedAt" TIMESTAMP(3),
    "lastDeliveryId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "fromLat" DOUBLE PRECISION,
    "fromLng" DOUBLE PRECISION,
    "toLat" DOUBLE PRECISION,
    "toLng" DOUBLE PRECISION,
    "receiver" TEXT NOT NULL,
    "packages" TEXT NOT NULL,
    "packageSize" TEXT NOT NULL,
    "packageWeight" DOUBLE PRECISION NOT NULL,
    "packageTypes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_deliveries_userId_idx" ON "recurring_deliveries"("userId");

-- CreateIndex
CREATE INDEX "recurring_deliveries_active_nextRunAt_idx" ON "recurring_deliveries"("active", "nextRunAt");

-- AddForeignKey
ALTER TABLE "recurring_deliveries" ADD CONSTRAINT "recurring_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
