CREATE TABLE "opening_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"hs_code" text NOT NULL,
	"sku" text NOT NULL,
	"uom" text NOT NULL,
	"branch_id" text NOT NULL,
	"branch_name" text NOT NULL,
	"date" date NOT NULL,
	"input_tax" text NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"vat_paid" numeric(18, 2) NOT NULL,
	"note" text,
	"bond_boe_no" text,
	"bond_boe_date" date,
	"bond_qty" numeric(18, 3),
	"bond_duty_foregone" numeric(18, 2),
	"process" text NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "opening_entries_process_check" CHECK ("opening_entries"."process" in ('Created','Approved','Cancelled')),
	CONSTRAINT "opening_entries_input_tax_check" CHECK ("opening_entries"."input_tax" in ('standard','reduced','zero','exempt')),
	CONSTRAINT "opening_entries_bond_check" CHECK (("opening_entries"."bond_boe_no" is null and "opening_entries"."bond_qty" is null) or ("opening_entries"."bond_boe_no" is not null and "opening_entries"."bond_qty" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "opening_entries_no_key" ON "opening_entries" USING btree ("no");--> statement-breakpoint
CREATE INDEX "opening_entries_live_idx" ON "opening_entries" USING btree ("created_at") WHERE "opening_entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "opening_entries_date_idx" ON "opening_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "opening_entries_item_idx" ON "opening_entries" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "opening_entries_branch_idx" ON "opening_entries" USING btree ("branch_id");