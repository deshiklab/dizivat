CREATE TABLE "batch_consumption" (
	"batch_id" text NOT NULL,
	"ord" integer NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"uom" text NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	CONSTRAINT "batch_consumption_batch_id_ord_pk" PRIMARY KEY("batch_id","ord")
);
--> statement-breakpoint
CREATE TABLE "batch_lines" (
	"batch_id" text NOT NULL,
	"ord" integer NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"uom" text NOT NULL,
	"work_order_id" text,
	"work_order_no" text,
	"issue_qty" numeric(18, 3) NOT NULL,
	"receive_qty" numeric(18, 3) NOT NULL,
	"damage_qty" numeric(18, 3) NOT NULL,
	"bom_id" text,
	"bom_version" integer,
	"unit_cost" numeric(18, 2) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	CONSTRAINT "batch_lines_batch_id_ord_pk" PRIMARY KEY("batch_id","ord"),
	CONSTRAINT "batch_lines_qty_check" CHECK ("batch_lines"."receive_qty" + "batch_lines"."damage_qty" <= "batch_lines"."issue_qty")
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"mode" text NOT NULL,
	"issue_date" date NOT NULL,
	"receive_date" date,
	"vendor_id" text,
	"vendor_name" text,
	"vendor_bin" text,
	"vendor_address" text,
	"address" text,
	"job_process" text,
	"remark" text,
	"issued_by" text NOT NULL,
	"designation" text NOT NULL,
	"issue_time" text,
	"total_issue" numeric(18, 3) NOT NULL,
	"total_receive" numeric(18, 3) NOT NULL,
	"total_damage" numeric(18, 3) NOT NULL,
	"material_value" numeric(18, 2) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"process" text NOT NULL,
	"received_at" timestamp (3) with time zone,
	"branch_id" text NOT NULL,
	"branch_name" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "batches_mode_check" CHECK ("batches"."mode" in ('inHouse','contractual','opening')),
	CONSTRAINT "batches_process_check" CHECK ("batches"."process" in ('Created','Approved','Cancelled')),
	CONSTRAINT "batches_vendor_check" CHECK ("batches"."vendor_id" is null or "batches"."mode" = 'contractual'),
	CONSTRAINT "batches_received_check" CHECK ("batches"."received_at" is null or "batches"."mode" = 'contractual'),
	CONSTRAINT "batches_job_process_check" CHECK ("batches"."job_process" is null or ("batches"."mode" = 'contractual' and "batches"."job_process" in ('manufacture','printing','embroidery','washing','dyeing','lamination','other')))
);
--> statement-breakpoint
CREATE INDEX "batch_consumption_item_idx" ON "batch_consumption" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "batch_lines_item_idx" ON "batch_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "batch_lines_work_order_idx" ON "batch_lines" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batches_no_key" ON "batches" USING btree ("no");--> statement-breakpoint
CREATE INDEX "batches_live_idx" ON "batches" USING btree ("created_at") WHERE "batches"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "batches_issue_date_idx" ON "batches" USING btree ("issue_date");--> statement-breakpoint
CREATE INDEX "batches_mode_idx" ON "batches" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "batches_vendor_idx" ON "batches" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "batches_branch_idx" ON "batches" USING btree ("branch_id");