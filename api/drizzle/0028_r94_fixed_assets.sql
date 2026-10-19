ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "purchases_category_check";--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_category_check" CHECK ("purchases"."category" is null or "purchases"."category" in ('goods','service','capital'));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_classes" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fixed_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"name" text NOT NULL,
	"class_id" text NOT NULL,
	"date" date NOT NULL,
	"cost" numeric(18, 2) NOT NULL,
	"salvage" numeric(18, 2) DEFAULT '0' NOT NULL,
	"branch_id" text,
	"purchase_id" text,
	"input_vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"creditable" boolean DEFAULT true NOT NULL,
	"memo" text,
	"process" text NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"history" jsonb,
	"revaluations" jsonb,
	"disposal" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "fixed_assets_process_check" CHECK ("process" in ('Created','Approved','Cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_classes_name_key" ON "asset_classes" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fixed_assets_no_key" ON "fixed_assets" USING btree ("no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fixed_assets_live_idx" ON "fixed_assets" USING btree ("created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fixed_assets_date_idx" ON "fixed_assets" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fixed_assets_class_idx" ON "fixed_assets" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fixed_assets_purchase_idx" ON "fixed_assets" USING btree ("purchase_id");
