-- The backfill below uses gen_random_uuid(), which is core only on PostgreSQL
-- 13+. Install pgcrypto so this migration is self-contained and portable to
-- older servers too (idempotent + no-op on PG 13+). Targets run PostgreSQL 16.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "SupportChatSenderRole" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "lastMessageAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "support_chat_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "senderRole" "SupportChatSenderRole" NOT NULL DEFAULT 'USER',
    "senderUserId" TEXT,
    "content" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_chat_messages_ticketId_createdAt_idx" ON "support_chat_messages"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "support_chat_messages" ADD CONSTRAINT "support_chat_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chat_messages" ADD CONSTRAINT "support_chat_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: seed one USER chat message per existing ticket from its opening
-- message so the new thread isn't empty, and set lastMessageAt. Idempotent
-- (skips tickets that already have a message) — safe to re-run. LEFT(…,2000)
-- guards the VARCHAR(2000) cap against any oversized legacy row.
INSERT INTO "support_chat_messages" ("id", "ticketId", "senderRole", "senderUserId", "content", "createdAt")
SELECT gen_random_uuid(), t."id", 'USER', t."userId", LEFT(t."message", 2000), t."createdAt"
FROM "support_tickets" t
WHERE NOT EXISTS (
  SELECT 1 FROM "support_chat_messages" m WHERE m."ticketId" = t."id"
);

UPDATE "support_tickets" t
SET "lastMessageAt" = COALESCE(t."lastMessageAt", t."createdAt");
