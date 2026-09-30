-- ============================================================
-- 0004_gamification.sql
-- Статусы детей, ачивки, благотворительность, новые подписки,
-- донаты с кешбэком.
-- Идемпотентно: можно запускать повторно.
-- ============================================================

-- ------------------------------------------------------------
-- Статусы детей
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "public"."child_rank" AS ENUM (
    'novice',
    'bronze',
    'silver',
    'gold',
    'platinum',
    'legend'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

ALTER TABLE "children"
  ADD COLUMN IF NOT EXISTS "rank" "child_rank" NOT NULL DEFAULT 'novice',
  ADD COLUMN IF NOT EXISTS "rank_updated_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "social_links" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "children_rank_idx" ON "children" ("rank");
--> statement-breakpoint

-- ------------------------------------------------------------
-- Ачивки
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "public"."achievement_kind" AS ENUM (
    'milestone',
    'social',
    'activity'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "achievements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(64) NOT NULL,
  "kind" "achievement_kind" NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "icon" varchar(64),
  "reward_points" integer NOT NULL DEFAULT 0,
  "condition" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "achievements_code_uq" ON "achievements" ("code");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "achievements_kind_idx" ON "achievements" ("kind");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "achievements_active_idx" ON "achievements" ("is_active");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "child_achievements" (
  "child_id" uuid NOT NULL,
  "achievement_id" uuid NOT NULL,
  "awarded_at" timestamp with time zone NOT NULL DEFAULT now(),
  "rewarded_at" timestamp with time zone,
  "points_awarded" integer NOT NULL DEFAULT 0,
  "meta" jsonb,
  CONSTRAINT "child_achievements_pk"
    PRIMARY KEY ("child_id", "achievement_id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "child_achievements_child_idx"
  ON "child_achievements" ("child_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "child_achievements_ach_idx"
  ON "child_achievements" ("achievement_id");
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "child_achievements"
    ADD CONSTRAINT "child_achievements_child_id_children_id_fk"
    FOREIGN KEY ("child_id") REFERENCES "public"."children"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "child_achievements"
    ADD CONSTRAINT "child_achievements_achievement_id_achievements_id_fk"
    FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ------------------------------------------------------------
-- Благотворительность
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "public"."donation_status" AS ENUM (
    'pending',
    'succeeded',
    'failed',
    'refunded'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "charity_settings" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "share_percent" smallint NOT NULL DEFAULT 80,
  "cashback_percent" smallint NOT NULL DEFAULT 10,
  "title" varchar(255) NOT NULL DEFAULT '80% выручки — на благотворительность',
  "description" text,
  "fund_name" varchar(255),
  "fund_url" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "charity_settings_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint

INSERT INTO "charity_settings"
  ("id", "share_percent", "cashback_percent", "title", "description", "fund_name")
VALUES (
  1,
  80,
  10,
  '80% выручки с подписок — на благотворительность',
  'Мы перечисляем 80% от каждой оплаты подписки в благотворительный фонд «Улыбка детям».',
  'Фонд «Улыбка детям»'
)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "donations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "parent_id" uuid NOT NULL,
  "amount_rub" integer NOT NULL,
  "cashback_rub" integer NOT NULL DEFAULT 0,
  "cashback_points" integer NOT NULL DEFAULT 0,
  "status" "donation_status" NOT NULL DEFAULT 'pending',
  "provider" "payment_provider" NOT NULL DEFAULT 'stub',
  "provider_payment_id" varchar(128),
  "raw_payload" jsonb,
  "idempotency_key" varchar(128) NOT NULL,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "donations_parent_idx" ON "donations" ("parent_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "donations_status_idx" ON "donations" ("status");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "donations_idem_uq" ON "donations" ("idempotency_key");
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "donations"
    ADD CONSTRAINT "donations_parent_id_parents_user_id_fk"
    FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("user_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ------------------------------------------------------------
-- points_reason: новые значения (IF NOT EXISTS обязателен)
-- ------------------------------------------------------------
ALTER TYPE "public"."points_reason" ADD VALUE IF NOT EXISTS 'achievement_reward';
--> statement-breakpoint
ALTER TYPE "public"."points_reason" ADD VALUE IF NOT EXISTS 'social_reward';
--> statement-breakpoint
ALTER TYPE "public"."points_reason" ADD VALUE IF NOT EXISTS 'donation_cashback';
--> statement-breakpoint

-- ------------------------------------------------------------
-- Новые тарифы
-- ------------------------------------------------------------
INSERT INTO "plans" ("code", "name", "price_rub", "period_days", "is_active", "is_default")
VALUES
  ('monthly',   'Месяц',     190,  30,  true, false),
  ('quarterly', '3 месяца',  490,  90,  true, false),
  ('yearly',    'Год',       1690, 365, true, true)
ON CONFLICT ("code") DO UPDATE
  SET "name"       = EXCLUDED."name",
      "price_rub"  = EXCLUDED."price_rub",
      "period_days"= EXCLUDED."period_days",
      "is_active"  = EXCLUDED."is_active",
      "is_default" = EXCLUDED."is_default",
      "updated_at" = now();
--> statement-breakpoint

UPDATE "plans" SET "is_default" = false WHERE "code" <> 'yearly';
--> statement-breakpoint
UPDATE "plans" SET "is_default" = true  WHERE "code" = 'yearly';