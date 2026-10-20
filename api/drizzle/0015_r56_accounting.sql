CREATE TABLE "accounting_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"closed_up_to" date,
	"allow_advance" boolean NOT NULL,
	"auto_allocate" boolean NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"updated_by" text,
	CONSTRAINT "accounting_config_single_row" CHECK ("accounting_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "money_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"account_no" text NOT NULL,
	"owner" text NOT NULL,
	"branch" text,
	"address" text,
	"bank_type" text,
	"wallet_type" text,
	"authorised" text,
	"service_charge" numeric(6, 3) NOT NULL,
	"opening_balance" numeric(18, 2) NOT NULL,
	"opening_date" date NOT NULL,
	"active" boolean NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"history" jsonb,
	CONSTRAINT "money_accounts_kind_check" CHECK ("money_accounts"."kind" in ('bank','mobile','cash')),
	CONSTRAINT "money_accounts_bank_type_check" CHECK ("money_accounts"."bank_type" is null or "money_accounts"."bank_type" in ('current','savings','transaction','other')),
	CONSTRAINT "money_accounts_wallet_type_check" CHECK ("money_accounts"."wallet_type" is null or "money_accounts"."wallet_type" in ('personal','general','merchant')),
	CONSTRAINT "money_accounts_branch_check" CHECK ("money_accounts"."branch" is null or "money_accounts"."kind" = 'bank'),
	CONSTRAINT "money_accounts_bank_check" CHECK ("money_accounts"."bank_type" is null or "money_accounts"."kind" = 'bank'),
	CONSTRAINT "money_accounts_wallet_check" CHECK (("money_accounts"."wallet_type" is null and "money_accounts"."authorised" is null) or "money_accounts"."kind" = 'mobile')
);
--> statement-breakpoint
CREATE TABLE "money_allocations" (
	"doc_id" text NOT NULL,
	"ord" integer NOT NULL,
	"invoice_id" text NOT NULL,
	"invoice_no" text NOT NULL,
	"invoice_date" date NOT NULL,
	"invoice_total" numeric(18, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	CONSTRAINT "money_allocations_doc_id_ord_pk" PRIMARY KEY("doc_id","ord"),
	CONSTRAINT "money_allocations_amount_check" CHECK ("money_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "money_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"party_id" text NOT NULL,
	"party_name" text NOT NULL,
	"party_bin" text NOT NULL,
	"method" text NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text NOT NULL,
	"cheque_no" text,
	"cheque_date" date,
	"cheque_bank" text,
	"reference" text,
	"amount" numeric(18, 2) NOT NULL,
	"charge" numeric(18, 2) NOT NULL,
	"allocated" numeric(18, 2) NOT NULL,
	"unallocated" numeric(18, 2) NOT NULL,
	"note" text,
	"process" text NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "money_docs_kind_check" CHECK ("money_docs"."kind" in ('receipt','payment')),
	CONSTRAINT "money_docs_method_check" CHECK ("money_docs"."method" in ('cash','bankTransfer','cheque','mobile')),
	CONSTRAINT "money_docs_process_check" CHECK ("money_docs"."process" in ('Created','Approved','Cancelled')),
	CONSTRAINT "money_docs_cheque_check" CHECK ("money_docs"."cheque_no" is null or "money_docs"."method" = 'cheque'),
	CONSTRAINT "money_docs_allocated_check" CHECK ("money_docs"."allocated" >= 0 and "money_docs"."allocated" <= "money_docs"."amount" + 0.004 and "money_docs"."unallocated" = "money_docs"."amount" - "money_docs"."allocated")
);
--> statement-breakpoint
CREATE INDEX "money_accounts_kind_idx" ON "money_accounts" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "money_accounts_provider_idx" ON "money_accounts" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "money_allocations_invoice_idx" ON "money_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "money_allocations_invoice_key" ON "money_allocations" USING btree ("doc_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "money_docs_no_key" ON "money_docs" USING btree ("no");--> statement-breakpoint
CREATE INDEX "money_docs_live_idx" ON "money_docs" USING btree ("created_at") WHERE "money_docs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "money_docs_kind_idx" ON "money_docs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "money_docs_party_idx" ON "money_docs" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "money_docs_account_idx" ON "money_docs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "money_docs_date_idx" ON "money_docs" USING btree ("date");