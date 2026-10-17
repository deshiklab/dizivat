-- R6.2: the exporters' Utilization Declarations / Utilization Permissions. A declaration is a row of `uds`, the
-- inputs it permits (with the quantity and the value of each) are rows of `ud_lines`, and the amendment certificates
-- behind it travel with the head as JSONB, exactly as the in-memory world carried them.
CREATE TABLE "ud_lines" (
	"ud_id" text NOT NULL,
	"ord" integer NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"hs_code" text NOT NULL,
	"uom" text NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"value" numeric(18, 2),
	CONSTRAINT "ud_lines_ud_id_ord_pk" PRIMARY KEY("ud_id","ord"),
	CONSTRAINT "ud_lines_qty_check" CHECK ("ud_lines"."qty" > 0),
	CONSTRAINT "ud_lines_value_check" CHECK ("ud_lines"."value" is null or "ud_lines"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "uds" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"customer_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_bin" text NOT NULL,
	"master_lc_no" text NOT NULL,
	"buyer" text,
	"expiry" date NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"master_lc_value" numeric(18, 2),
	"currency" text,
	"amendments" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "uds_kind_check" CHECK ("uds"."kind" in ('UD','UP')),
	CONSTRAINT "uds_status_check" CHECK ("uds"."status" in ('active','closed')),
	CONSTRAINT "uds_expiry_check" CHECK ("uds"."expiry" >= "uds"."date"),
	CONSTRAINT "uds_master_lc_value_check" CHECK ("uds"."master_lc_value" is null or "uds"."master_lc_value" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ud_lines_item_idx" ON "ud_lines" USING btree ("item_id");--> statement-breakpoint
-- one exporter cannot hold the same declaration number twice; a deleted declaration frees its number again, as the
-- mock's array did
CREATE UNIQUE INDEX "uds_no_key" ON "uds" USING btree ("customer_id","no") WHERE "uds"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "uds_live_idx" ON "uds" USING btree ("created_at") WHERE "uds"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "uds_customer_idx" ON "uds" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "uds_expiry_idx" ON "uds" USING btree ("expiry");
