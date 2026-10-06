CREATE TABLE "bom_costs" (
	"bom_id" text NOT NULL,
	"ord" integer NOT NULL,
	"head" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	CONSTRAINT "bom_costs_bom_id_ord_pk" PRIMARY KEY("bom_id","ord"),
	CONSTRAINT "bom_costs_head_check" CHECK ("bom_costs"."head" in ('labour','power','overhead','packing','admin','finance','profit','other')),
	CONSTRAINT "bom_costs_amount_check" CHECK ("bom_costs"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "bom_inputs" (
	"bom_id" text NOT NULL,
	"ord" integer NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"uom" text NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"wastage_pct" numeric(8, 6) NOT NULL,
	"wastage_qty" numeric(18, 4) NOT NULL,
	"gross_qty" numeric(18, 4) NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"wastage_value" numeric(18, 2) NOT NULL,
	CONSTRAINT "bom_inputs_bom_id_ord_pk" PRIMARY KEY("bom_id","ord"),
	CONSTRAINT "bom_inputs_wastage_check" CHECK ("bom_inputs"."wastage_pct" >= 0 and "bom_inputs"."wastage_pct" <= 50)
);
--> statement-breakpoint
CREATE TABLE "boms" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"item_id" text NOT NULL,
	"item_name" text NOT NULL,
	"sku" text NOT NULL,
	"hs_code" text NOT NULL,
	"uom" text NOT NULL,
	"version" integer NOT NULL,
	"license_date" date,
	"effective_date" date NOT NULL,
	"amendment_reason" text,
	"note" text,
	"material_value" numeric(18, 2) NOT NULL,
	"wastage_value" numeric(18, 2) NOT NULL,
	"value_added" numeric(18, 2) NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"unit_cost" numeric(18, 2) NOT NULL,
	"process" text NOT NULL,
	"superseded_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "boms_process_check" CHECK ("boms"."process" in ('Created','Approved','Cancelled')),
	CONSTRAINT "boms_superseded_check" CHECK ("boms"."superseded_at" is null or "boms"."process" = 'Approved'),
	CONSTRAINT "boms_version_check" CHECK ("boms"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "production_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"procedure" text NOT NULL,
	"consumption" text NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"updated_by" text,
	CONSTRAINT "production_config_single_row" CHECK ("production_config"."id" = 1),
	CONSTRAINT "production_config_procedure_check" CHECK ("production_config"."procedure" in ('directStock','workOrder')),
	CONSTRAINT "production_config_consumption_check" CHECK ("production_config"."consumption" in ('standard','actual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bom_costs_head_key" ON "bom_costs" USING btree ("bom_id","head");--> statement-breakpoint
CREATE INDEX "bom_inputs_item_idx" ON "bom_inputs" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_inputs_item_key" ON "bom_inputs" USING btree ("bom_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boms_live_no_key" ON "boms" USING btree ("no") WHERE "boms"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "boms_live_idx" ON "boms" USING btree ("created_at") WHERE "boms"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "boms_item_idx" ON "boms" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "boms_effective_date_idx" ON "boms" USING btree ("effective_date");