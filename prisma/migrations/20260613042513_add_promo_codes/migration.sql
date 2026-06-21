-- CreateEnum
CREATE TYPE "PromoDiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "PromoRedemptionStatus" AS ENUM ('REDEEMED', 'RELEASED');

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "PromoDiscountType" NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "minOrderTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxDiscount" DOUBLE PRECISION,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxRedemptions" INTEGER,
    "timesRedeemed" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL,
    "originalTotal" DOUBLE PRECISION NOT NULL,
    "finalTotal" DOUBLE PRECISION NOT NULL,
    "status" "PromoRedemptionStatus" NOT NULL DEFAULT 'REDEEMED',
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemptions_deliveryId_key" ON "promo_redemptions"("deliveryId");

-- CreateIndex
CREATE INDEX "promo_redemptions_promoCodeId_idx" ON "promo_redemptions"("promoCodeId");

-- CreateIndex
CREATE INDEX "promo_redemptions_userId_idx" ON "promo_redemptions"("userId");

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-user limit (=1) guard: a PARTIAL unique index Prisma can't express. Allows
-- RELEASED rows (after a cancel) to remain for audit without blocking re-use.
CREATE UNIQUE INDEX "promo_redemptions_active_per_user_key"
  ON "promo_redemptions"("promoCodeId", "userId")
  WHERE "status" = 'REDEEMED';

-- Demo promo codes (no admin surface yet). Idempotent; keep in sync with prisma/seed.ts.
INSERT INTO "promo_codes"
  ("id","code","description","discountType","discountValue","minOrderTotal","maxDiscount","active","maxRedemptions","timesRedeemed","perUserLimit","createdAt","updatedAt")
VALUES
  ('a0000000-0000-4000-8000-000000000001','WELCOME10','10% off your first delivery (up to $5)','PERCENT',10,0,5,true,1000,0,1,NOW(),NOW()),
  ('a0000000-0000-4000-8000-000000000002','DRONE5','$5 off orders of $15 or more','FIXED',5,15,NULL,true,500,0,1,NOW(),NOW())
ON CONFLICT ("code") DO NOTHING;
