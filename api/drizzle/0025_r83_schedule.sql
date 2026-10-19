CREATE TABLE IF NOT EXISTS "reminder_settings" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"settings" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"due" date NOT NULL,
	"lead" integer NOT NULL,
	"period" text NOT NULL,
	"at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"kind" text NOT NULL,
	"frequency" text NOT NULL,
	"day" integer NOT NULL,
	"recipients" jsonb NOT NULL,
	"enabled" boolean NOT NULL,
	"last_run" date,
	"next_run" date NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_log" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"schedule_id" text NOT NULL,
	"kind" text NOT NULL,
	"period" text,
	"as_of" date NOT NULL,
	"generated_at" timestamp (3) with time zone NOT NULL,
	"recipients" jsonb NOT NULL,
	"document" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminders_due_idx" ON "reminders" USING btree ("due");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_log_schedule_asof_key" ON "delivery_log" USING btree ("schedule_id","as_of");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_log_generated_idx" ON "delivery_log" USING btree ("generated_at");
