CREATE TABLE IF NOT EXISTS "pos_registers" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"branch_id" text NOT NULL,
	"branch_name" text NOT NULL,
	"cash_account_id" text NOT NULL,
	"card_account_id" text NOT NULL,
	"bkash_account_id" text NOT NULL,
	"nagad_account_id" text NOT NULL,
	"terminal_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_seq_no" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_registers_code_key" ON "pos_registers" USING btree ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_registers_branch_idx" ON "pos_registers" USING btree ("branch_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_shifts" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"register_id" text NOT NULL,
	"register_code" text NOT NULL,
	"register_name" text NOT NULL,
	"branch_id" text NOT NULL,
	"branch_name" text NOT NULL,
	"cash_account_id" text NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"opening_float" numeric(18, 2) NOT NULL,
	"opened_at" timestamp (3) with time zone NOT NULL,
	"opened_by" text NOT NULL,
	"closed_at" timestamp (3) with time zone,
	"closed_by" text,
	"z_no" text,
	"expected_cash" numeric(18, 2),
	"counted_cash" numeric(18, 2),
	"variance" numeric(18, 2),
	"note" text,
	"history" jsonb NOT NULL,
	CONSTRAINT "pos_shifts_status_check" CHECK ("pos_shifts"."status" in ('open','closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_shifts_no_key" ON "pos_shifts" USING btree ("no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_shifts_register_idx" ON "pos_shifts" USING btree ("register_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_shifts_date_idx" ON "pos_shifts" USING btree ("date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_sales" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"invoice_no" text NOT NULL,
	"challan_no" text NOT NULL,
	"issue_date" date NOT NULL,
	"issue_time" text NOT NULL,
	"process" text NOT NULL,
	"register_id" text NOT NULL,
	"register_code" text NOT NULL,
	"register_name" text NOT NULL,
	"shift_id" text NOT NULL,
	"shift_no" text NOT NULL,
	"branch_id" text NOT NULL,
	"branch_name" text NOT NULL,
	"customer_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_bin" text NOT NULL,
	"customer_mobile" text,
	"customer_address" text NOT NULL,
	"lines" jsonb NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"sd" numeric(18, 2) NOT NULL,
	"vat" numeric(18, 2) NOT NULL,
	"discount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"net_total" numeric(18, 2) NOT NULL,
	"tenders" jsonb NOT NULL,
	"tendered_total" numeric(18, 2) NOT NULL,
	"change_given" numeric(18, 2) DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"seq_no" integer,
	"source" text NOT NULL,
	"nbr_adapter" jsonb NOT NULL,
	"issued_by" text NOT NULL,
	"designation" text NOT NULL,
	"note" text,
	"cancel_reason" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"history" jsonb NOT NULL,
	CONSTRAINT "pos_sales_process_check" CHECK ("pos_sales"."process" in ('Created','Approved','Cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_sales_invoice_no_key" ON "pos_sales" USING btree ("invoice_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_sales_shift_idx" ON "pos_sales" USING btree ("shift_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_sales_register_idx" ON "pos_sales" USING btree ("register_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_sales_date_idx" ON "pos_sales" USING btree ("issue_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text NOT NULL,
	"channel" text NOT NULL,
	"source" text NOT NULL,
	"from" date NOT NULL,
	"to" date NOT NULL,
	"imported_at" timestamp (3) with time zone NOT NULL,
	"imported_by" text NOT NULL,
	"line_count" integer NOT NULL,
	"gross_total" numeric(18, 2) NOT NULL,
	"fee_total" numeric(18, 2) NOT NULL,
	"net_total" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_settlements_no_key" ON "pos_settlements" USING btree ("no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_settlements_account_idx" ON "pos_settlements" USING btree ("account_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_settlement_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"statement_id" text NOT NULL,
	"row_no" integer NOT NULL,
	"date" date NOT NULL,
	"channel" text NOT NULL,
	"reference" text NOT NULL,
	"narration" text NOT NULL,
	"gross" numeric(18, 2) NOT NULL,
	"fee" numeric(18, 2) NOT NULL,
	"net" numeric(18, 2) NOT NULL,
	"status" text NOT NULL,
	"sale_id" text,
	"invoice_no" text,
	"tender_method" text,
	"expected_fee" numeric(18, 2),
	"suggestion" jsonb,
	"note" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_settlement_lines_statement_row_key" ON "pos_settlement_lines" USING btree ("statement_id","row_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_settlement_lines_statement_idx" ON "pos_settlement_lines" USING btree ("statement_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_settlement_lines_sale_idx" ON "pos_settlement_lines" USING btree ("sale_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"name" text NOT NULL,
	"register_id" text NOT NULL,
	"register_code" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"created_by" text NOT NULL,
	"last_used_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_tokens_hash_key" ON "pos_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_tokens_register_idx" ON "pos_tokens" USING btree ("register_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"events" jsonb NOT NULL,
	"secret" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"created_by" text NOT NULL,
	"last_delivery_at" timestamp (3) with time zone,
	"last_status" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"webhook_id" text NOT NULL,
	"webhook_name" text NOT NULL,
	"event" text NOT NULL,
	"ref" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature" text NOT NULL,
	"status" text NOT NULL,
	"delivered_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_webhook_deliveries_webhook_idx" ON "pos_webhook_deliveries" USING btree ("webhook_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"register_id" text NOT NULL,
	"register_code" text NOT NULL,
	"seq_no" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"sale_id" text NOT NULL,
	"invoice_no" text NOT NULL,
	"net_total" numeric(18, 2) NOT NULL,
	"client_created_at" timestamp (3) with time zone NOT NULL,
	"synced_at" timestamp (3) with time zone NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_queue_register_seq_key" ON "pos_queue" USING btree ("register_id","seq_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_queue_register_idx" ON "pos_queue" USING btree ("register_id");
