CREATE TABLE "treasury_deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"head" text NOT NULL,
	"code" text NOT NULL,
	"tax_period" text NOT NULL,
	"challan_no" text NOT NULL,
	"challan_date" date NOT NULL,
	"mode" text NOT NULL,
	"bank" text NOT NULL,
	"bank_branch" text NOT NULL,
	"district" text NOT NULL,
	"bank_address" text,
	"account_id" text,
	"amount" numeric(18, 2) NOT NULL,
	"depositor" text NOT NULL,
	"designation" text,
	"address" text NOT NULL,
	"description" text NOT NULL,
	"process" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "treasury_deposits_head_check" CHECK ("treasury_deposits"."head" in ('vat','vds','sd','interest','penalty','excise','devSurcharge','ictSurcharge','healthSurcharge','envSurcharge')),
	CONSTRAINT "treasury_deposits_mode_check" CHECK ("treasury_deposits"."mode" in ('cash','cheque','payOrder','draft','online')),
	CONSTRAINT "treasury_deposits_process_check" CHECK ("treasury_deposits"."process" in ('Created','Approved','Cancelled')),
	CONSTRAINT "treasury_deposits_amount_check" CHECK ("treasury_deposits"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "vat_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"kind" text NOT NULL,
	"note" integer NOT NULL,
	"issue_date" date NOT NULL,
	"tax_period" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"sd_export" jsonb,
	"process" text NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "vat_adjustments_kind_check" CHECK ("vat_adjustments"."kind" in ('otherIncrease','otherDecrease','sdIncrease','sdDecrease','sdExport')),
	CONSTRAINT "vat_adjustments_process_check" CHECK ("vat_adjustments"."process" in ('Created','Approved','Cancelled')),
	CONSTRAINT "vat_adjustments_note_check" CHECK ("vat_adjustments"."note" in (27, 32, 38, 39, 40)),
	CONSTRAINT "vat_adjustments_amount_check" CHECK ("vat_adjustments"."amount" > 0),
	CONSTRAINT "vat_adjustments_sd_export_check" CHECK (("vat_adjustments"."sd_export" is null and "vat_adjustments"."kind" <> 'sdExport') or ("vat_adjustments"."sd_export" is not null and "vat_adjustments"."kind" = 'sdExport'))
);
--> statement-breakpoint
CREATE TABLE "vds_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"mode" text NOT NULL,
	"doc_id" text NOT NULL,
	"doc_no" text NOT NULL,
	"challan_no" text NOT NULL,
	"doc_date" date NOT NULL,
	"party_id" text NOT NULL,
	"party_name" text NOT NULL,
	"party_bin" text NOT NULL,
	"party_address" text NOT NULL,
	"doc_value" numeric(18, 2) NOT NULL,
	"doc_vat" numeric(18, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"certificate_no" text,
	"certificate_date" date NOT NULL,
	"tax_period" text NOT NULL,
	"treasury_id" text,
	"treasury_challan" text,
	"remark" text,
	"settled" numeric(18, 2),
	"process" text NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "vds_entries_mode_check" CHECK ("vds_entries"."mode" in ('purchase','sales')),
	CONSTRAINT "vds_entries_process_check" CHECK ("vds_entries"."process" in ('Created','Approved','Cancelled')),
	CONSTRAINT "vds_entries_amount_check" CHECK ("vds_entries"."amount" > 0),
	CONSTRAINT "vds_entries_settled_check" CHECK ("vds_entries"."settled" is null or ("vds_entries"."settled" >= 0 and "vds_entries"."settled" <= "vds_entries"."amount" + 0.004)),
	CONSTRAINT "vds_entries_treasury_check" CHECK ("vds_entries"."treasury_id" is null or "vds_entries"."mode" = 'purchase')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_deposits_no_key" ON "treasury_deposits" USING btree ("no");--> statement-breakpoint
CREATE INDEX "treasury_deposits_live_idx" ON "treasury_deposits" USING btree ("created_at") WHERE "treasury_deposits"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "treasury_deposits_head_idx" ON "treasury_deposits" USING btree ("head");--> statement-breakpoint
CREATE INDEX "treasury_deposits_period_idx" ON "treasury_deposits" USING btree ("tax_period");--> statement-breakpoint
CREATE INDEX "treasury_deposits_account_idx" ON "treasury_deposits" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "treasury_deposits_challan_date_idx" ON "treasury_deposits" USING btree ("challan_date");--> statement-breakpoint
CREATE UNIQUE INDEX "vat_adjustments_no_key" ON "vat_adjustments" USING btree ("no");--> statement-breakpoint
CREATE INDEX "vat_adjustments_live_idx" ON "vat_adjustments" USING btree ("created_at") WHERE "vat_adjustments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "vat_adjustments_kind_idx" ON "vat_adjustments" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "vat_adjustments_period_idx" ON "vat_adjustments" USING btree ("tax_period");--> statement-breakpoint
CREATE INDEX "vat_adjustments_issue_date_idx" ON "vat_adjustments" USING btree ("issue_date");--> statement-breakpoint
CREATE UNIQUE INDEX "vds_entries_no_key" ON "vds_entries" USING btree ("no");--> statement-breakpoint
CREATE INDEX "vds_entries_live_idx" ON "vds_entries" USING btree ("created_at") WHERE "vds_entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "vds_entries_mode_idx" ON "vds_entries" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "vds_entries_doc_idx" ON "vds_entries" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "vds_entries_party_idx" ON "vds_entries" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "vds_entries_period_idx" ON "vds_entries" USING btree ("tax_period");--> statement-breakpoint
CREATE INDEX "vds_entries_treasury_idx" ON "vds_entries" USING btree ("treasury_id");--> statement-breakpoint
CREATE INDEX "vds_entries_certificate_date_idx" ON "vds_entries" USING btree ("certificate_date");