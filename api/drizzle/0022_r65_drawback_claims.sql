CREATE TABLE "drawback_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"status" text NOT NULL,
	"method" text NOT NULL,
	"lines" jsonb NOT NULL,
	"cd" numeric(18, 2) NOT NULL,
	"rd" numeric(18, 2) NOT NULL,
	"claimed" numeric(18, 2) NOT NULL,
	"filed_on" date,
	"dedo_ref" text,
	"sanctioned_on" date,
	"sanctioned" numeric(18, 2),
	"disallowed_reason" text,
	"paid_on" date,
	"paid" numeric(18, 2),
	"pay_ref" text,
	"rejected_on" date,
	"reject_reason" text,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "drawback_claims_status_check" CHECK ("drawback_claims"."status" in ('draft','filed','sanctioned','paid','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "drawback_claims_no_key" ON "drawback_claims" USING btree ("no") WHERE "drawback_claims"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "drawback_claims_created_idx" ON "drawback_claims" USING btree ("created_at") WHERE "drawback_claims"."deleted_at" is null;