CREATE TABLE "prc_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"file_name" text NOT NULL,
	"status" text NOT NULL,
	"lines" jsonb NOT NULL,
	"skipped" integer NOT NULL,
	"invoices" integer NOT NULL,
	"fc_totals" jsonb NOT NULL,
	"bdt" numeric(18, 2) NOT NULL,
	"reversed_on" date,
	"reverse_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "prc_batches_status_check" CHECK ("prc_batches"."status" in ('posted','reversed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prc_batches_no_key" ON "prc_batches" USING btree ("no") WHERE "prc_batches"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "prc_batches_created_idx" ON "prc_batches" USING btree ("created_at") WHERE "prc_batches"."deleted_at" is null;