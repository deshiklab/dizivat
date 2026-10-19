CREATE TABLE "vat_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"period" text NOT NULL,
	"type" text NOT NULL,
	"amend_reason" text,
	"activities" boolean NOT NULL,
	"status" text NOT NULL,
	"submission_date" date,
	"manual" jsonb NOT NULL,
	"snapshot" jsonb,
	"ack_no" text,
	"submitted_by" text,
	"submitted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"history" jsonb,
	CONSTRAINT "vat_returns_status_check" CHECK ("vat_returns"."status" in ('draft','submitted')),
	CONSTRAINT "vat_returns_type_check" CHECK ("vat_returns"."type" in ('original','amended','full','late')),
	CONSTRAINT "vat_returns_submitted_check" CHECK (("vat_returns"."status" = 'draft' and "vat_returns"."snapshot" is null and "vat_returns"."ack_no" is null) or ("vat_returns"."status" = 'submitted' and "vat_returns"."snapshot" is not null and "vat_returns"."ack_no" is not null and "vat_returns"."submission_date" is not null)),
	CONSTRAINT "vat_returns_amend_reason_check" CHECK (("vat_returns"."type" = 'amended') = ("vat_returns"."amend_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "vat_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"zone_code" text NOT NULL,
	"profile" jsonb,
	"updated_at" timestamp (3) with time zone,
	"updated_by" text,
	CONSTRAINT "vat_settings_single_row" CHECK ("vat_settings"."id" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vat_returns_period_key" ON "vat_returns" USING btree ("period");--> statement-breakpoint
CREATE INDEX "vat_returns_status_idx" ON "vat_returns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vat_returns_type_idx" ON "vat_returns" USING btree ("type");--> statement-breakpoint
CREATE INDEX "vat_returns_ord_idx" ON "vat_returns" USING btree ("ord");