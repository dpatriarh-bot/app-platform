CREATE TABLE IF NOT EXISTS "question_type_settings" (
	"type" "question_type" PRIMARY KEY NOT NULL,
	"title" varchar(128) NOT NULL,
	"description" text,
	"icon" varchar(64),
	"is_enabled" boolean DEFAULT true NOT NULL,
	"default_points" integer DEFAULT 2 NOT NULL,
	"min_options" smallint,
	"max_options" smallint,
	"requires_image" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"allowed_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "question_type_settings_enabled_idx" ON "question_type_settings" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "question_type_settings_sort_idx" ON "question_type_settings" USING btree ("sort_order");