CREATE TABLE "backups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"slot" text NOT NULL,
	"by" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"tables" jsonb NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "backups_kind_check" CHECK ("backups"."kind" in ('scheduled','manual'))
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "access_until" date;--> statement-breakpoint
CREATE INDEX "backups_at_idx" ON "backups" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "backups_scheduled_slot_key" ON "backups" USING btree ("slot") WHERE "backups"."kind" = 'scheduled';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_officer_access_check" CHECK ("users"."role" <> 'vatOfficer' or "users"."access_until" is not null);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin','approver','operator','viewer','vatOfficer'));