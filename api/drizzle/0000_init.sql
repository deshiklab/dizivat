CREATE SEQUENCE "public"."unit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp (3) with time zone NOT NULL,
	"day" date NOT NULL,
	"actor" text NOT NULL,
	"actor_id" text,
	"entity" text NOT NULL,
	"entity_id" text,
	"ref" text NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"vat_slab" text NOT NULL,
	"bin" text NOT NULL,
	"tin" text NOT NULL,
	"mobile" text NOT NULL,
	"phone" text,
	"email" text NOT NULL,
	"address" text NOT NULL,
	"owner" jsonb NOT NULL,
	"signatory" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"updated_by" text,
	CONSTRAINT "company_single_row" CHECK ("company"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "compat_state" (
	"key" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_failures" (
	"username" text PRIMARY KEY NOT NULL,
	"failures" integer NOT NULL,
	"locked_until" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"user_id" text NOT NULL,
	"table_key" text NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"pos" bigserial NOT NULL,
	CONSTRAINT "saved_views_user_id_table_key_name_pk" PRIMARY KEY("user_id","table_key","name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"remember" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"revoke_reason" text,
	"user_agent" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "tariff_lines" (
	"fy" text NOT NULL,
	"hs_code" text NOT NULL,
	"description" text NOT NULL,
	"chapter" text NOT NULL,
	"cd" numeric(7, 2) NOT NULL,
	"sd" numeric(7, 2) NOT NULL,
	"vat" numeric(7, 2) NOT NULL,
	"ait" numeric(7, 2) NOT NULL,
	"rd" numeric(7, 2) NOT NULL,
	"at" numeric(7, 2) NOT NULL,
	"tti" numeric(9, 2) NOT NULL,
	CONSTRAINT "tariff_lines_fy_hs_code_pk" PRIMARY KEY("fy","hs_code")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"decimals" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"designation" text NOT NULL,
	"initials" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"mobile" text,
	"department" text,
	"active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"password_hash" text NOT NULL,
	"password_is_demo" boolean DEFAULT false NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp (3) with time zone,
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin','approver','operator','viewer'))
);
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_day_idx" ON "audit_events" USING btree ("day");--> statement-breakpoint
CREATE INDEX "audit_entity_id_idx" ON "audit_events" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_code_lower_key" ON "units" USING btree (lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));