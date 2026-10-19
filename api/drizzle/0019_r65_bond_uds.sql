CREATE TABLE "bond_ud_garments" (
	"ud_id" text NOT NULL,
	"ord" integer NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"uom" text NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	CONSTRAINT "bond_ud_garments_ud_id_ord_pk" PRIMARY KEY("ud_id","ord"),
	CONSTRAINT "bond_ud_garments_qty_check" CHECK ("bond_ud_garments"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "bond_ud_inputs" (
	"ud_id" text NOT NULL,
	"ord" integer NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"hs_code" text NOT NULL,
	"uom" text NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	CONSTRAINT "bond_ud_inputs_ud_id_ord_pk" PRIMARY KEY("ud_id","ord"),
	CONSTRAINT "bond_ud_inputs_qty_check" CHECK ("bond_ud_inputs"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "bond_uds" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"kind" text NOT NULL,
	"issuer" text NOT NULL,
	"date" date NOT NULL,
	"expiry" date NOT NULL,
	"master_lc_no" text NOT NULL,
	"master_lc_value" numeric(18, 2),
	"currency" text,
	"buyer" text,
	"note" text,
	"settlement" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "bond_uds_kind_check" CHECK ("bond_uds"."kind" in ('UD','UP')),
	CONSTRAINT "bond_uds_issuer_check" CHECK ("bond_uds"."issuer" in ('BGMEA','BKMEA','Customs')),
	CONSTRAINT "bond_uds_expiry_check" CHECK ("bond_uds"."expiry" >= "bond_uds"."date"),
	CONSTRAINT "bond_uds_master_lc_value_check" CHECK ("bond_uds"."master_lc_value" is null or "bond_uds"."master_lc_value" >= 0)
);
--> statement-breakpoint
CREATE INDEX "bond_ud_garments_item_idx" ON "bond_ud_garments" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "bond_ud_inputs_item_idx" ON "bond_ud_inputs" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bond_uds_no_key" ON "bond_uds" USING btree ("no") WHERE "bond_uds"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "bond_uds_live_idx" ON "bond_uds" USING btree ("created_at") WHERE "bond_uds"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "bond_uds_expiry_idx" ON "bond_uds" USING btree ("expiry");