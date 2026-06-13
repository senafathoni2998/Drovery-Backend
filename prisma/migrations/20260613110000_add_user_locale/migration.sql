-- AlterTable: per-user language for server-emitted content (notifications/emails/
-- support). NOT NULL + DEFAULT backfills every existing row — no data migration.
ALTER TABLE "users" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
