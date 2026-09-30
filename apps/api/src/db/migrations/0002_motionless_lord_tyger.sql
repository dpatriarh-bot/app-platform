-- ============================================================
-- 0002_motionless_lord_tyger.sql
-- Добавляет:
--   • user_role: значение 'partner' перед 'manager'
--   • users.partner_id, users.fraud_disabled, users.created_by
--   • индекс users_partner_idx
-- FK users.partner_id → partners.id создаётся в 0003
-- (чтобы не дублировать его здесь).
-- ============================================================

-- ALTER TYPE ... ADD VALUE не может идти в транзакции вместе с
-- использованием нового значения в той же транзакции, поэтому
-- сначала только ALTER, изменения колонок — дальше.
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'partner' BEFORE 'manager';
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "partner_id" uuid;
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "fraud_disabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_by" uuid;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_partner_idx" ON "users" USING btree ("partner_id");