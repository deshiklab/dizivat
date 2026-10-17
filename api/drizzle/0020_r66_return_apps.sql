CREATE TABLE "late_filings" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"period" text NOT NULL,
	"reason_kind" text NOT NULL,
	"reason" text NOT NULL,
	"requested_date" date NOT NULL,
	"status" text NOT NULL,
	"filed_on" date,
	"filed_ref" text,
	"decided_on" date,
	"commissioner_ref" text,
	"granted_date" date,
	"reject_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "late_filings_status_check" CHECK ("late_filings"."status" in ('draft','filed','approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "return_amendments" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"period" text NOT NULL,
	"reason_kind" text NOT NULL,
	"description" text NOT NULL,
	"corrections" jsonb NOT NULL,
	"no_audit" boolean NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"filed_on" date,
	"filed_ref" text,
	"decided_on" date,
	"commissioner_ref" text,
	"reject_reason" text,
	"adjust_period" text,
	"amended" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "return_amendments_status_check" CHECK ("return_amendments"."status" in ('draft','filed','approved','rejected','amended')),
	CONSTRAINT "return_amendments_revision_check" CHECK ("return_amendments"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "late_filings_no_key" ON "late_filings" USING btree ("no") WHERE "late_filings"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "late_filings_period_key" ON "late_filings" USING btree ("period") WHERE "late_filings"."deleted_at" is null and "late_filings"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "late_filings_live_idx" ON "late_filings" USING btree ("created_at") WHERE "late_filings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "late_filings_status_idx" ON "late_filings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "return_amendments_no_key" ON "return_amendments" USING btree ("no") WHERE "return_amendments"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "return_amendments_period_key" ON "return_amendments" USING btree ("period") WHERE "return_amendments"."deleted_at" is null and "return_amendments"."status" <> 'rejected' and "return_amendments"."status" <> 'amended';--> statement-breakpoint
CREATE INDEX "return_amendments_live_idx" ON "return_amendments" USING btree ("created_at") WHERE "return_amendments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "return_amendments_status_idx" ON "return_amendments" USING btree ("status");