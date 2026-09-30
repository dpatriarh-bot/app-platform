-- ============================================================
-- 0005_child_notifications.sql
-- Уведомления для ребёнка (в интерфейсе kiosk/ЛК)
-- ============================================================

CREATE TABLE IF NOT EXISTS "child_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "child_id" uuid NOT NULL,
  "type" varchar(48) NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text,
  "link" varchar(255),
  "is_read" boolean NOT NULL DEFAULT false,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "child_notifications_child_idx"
  ON "child_notifications" ("child_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "child_notifications_unread_idx"
  ON "child_notifications" ("child_id", "is_read")
  WHERE "is_read" = false;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "child_notifications"
    ADD CONSTRAINT "child_notifications_child_id_children_id_fk"
    FOREIGN KEY ("child_id") REFERENCES "public"."children"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;