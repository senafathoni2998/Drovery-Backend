-- CreateTable
CREATE TABLE "proof_of_delivery" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "recipientName" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "notes" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proof_of_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proof_of_delivery_deliveryId_key" ON "proof_of_delivery"("deliveryId");

-- AddForeignKey
ALTER TABLE "proof_of_delivery" ADD CONSTRAINT "proof_of_delivery_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
