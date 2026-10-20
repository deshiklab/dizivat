CREATE TABLE "work_order_lines" (
	"work_order_id" text NOT NULL,
	"ord" integer NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"uom" text NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"issued" numeric(18, 3),
	"received" numeric(18, 3) NOT NULL,
	"damaged" numeric(18, 3) NOT NULL,
	"remaining" numeric(18, 3) NOT NULL,
	CONSTRAINT "work_order_lines_work_order_id_ord_pk" PRIMARY KEY("work_order_id","ord"),
	CONSTRAINT "work_order_lines_qty_check" CHECK ("work_order_lines"."received" + "work_order_lines"."damaged" <= "work_order_lines"."issued"),
	CONSTRAINT "work_order_lines_remaining_check" CHECK ("work_order_lines"."remaining" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"requisition_no" text,
	"issue_date" date NOT NULL,
	"due_date" date,
	"remark" text,
	"process" text NOT NULL,
	"status" text NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "work_orders_process_check" CHECK ("work_orders"."process" in ('Created','Approved','Cancelled')),
	CONSTRAINT "work_orders_status_check" CHECK ("work_orders"."status" in ('draft','open','partial','completed','cancelled')),
	CONSTRAINT "work_orders_draft_check" CHECK (("work_orders"."process" = 'Created') = ("work_orders"."status" = 'draft')),
	CONSTRAINT "work_orders_cancelled_check" CHECK (("work_orders"."process" = 'Cancelled') = ("work_orders"."status" = 'cancelled')),
	CONSTRAINT "work_orders_due_check" CHECK ("work_orders"."due_date" is null or "work_orders"."due_date" >= "work_orders"."issue_date")
);
--> statement-breakpoint
CREATE INDEX "work_order_lines_item_idx" ON "work_order_lines" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_lines_item_key" ON "work_order_lines" USING btree ("work_order_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_no_key" ON "work_orders" USING btree ("no");--> statement-breakpoint
CREATE INDEX "work_orders_live_idx" ON "work_orders" USING btree ("created_at") WHERE "work_orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "work_orders_issue_date_idx" ON "work_orders" USING btree ("issue_date");--> statement-breakpoint
CREATE INDEX "work_orders_status_idx" ON "work_orders" USING btree ("status");