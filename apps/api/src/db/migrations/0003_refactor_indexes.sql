-- ============================================================
-- 0003_refactor_indexes.sql
-- 1. FK users.partner_id -> partners.id
-- 2. Partial unique index attempts(child_id) WHERE status='in_progress'
-- ============================================================

DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_partner_id_fk"
    FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "attempts_one_active_per_child_uq"
  ON "attempts" ("child_id")
  WHERE "status" = 'in_progress';