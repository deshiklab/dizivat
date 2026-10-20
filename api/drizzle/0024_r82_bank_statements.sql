CREATE TABLE IF NOT EXISTS "bank_statement_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"statement_id" text NOT NULL,
	"ord" integer NOT NULL,
	"row_no" integer NOT NULL,
	"date" date NOT NULL,
	"narration" text NOT NULL,
	"reference" text,
	"cheque_no" text,
	"deposit" numeric(18, 2) NOT NULL,
	"withdrawal" numeric(18, 2) NOT NULL,
	"status" text NOT NULL,
	"match_kind" text,
	"match_id" text,
	"match_no" text,
	"money_id" text,
	"money_no" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text NOT NULL,
	"source" text NOT NULL,
	"from" date NOT NULL,
	"to" date NOT NULL,
	"closing_balance" numeric(18, 2),
	"imported_at" timestamp (3) with time zone NOT NULL,
	"imported_by" text NOT NULL,
	"line_count" integer NOT NULL,
	"deposit_total" numeric(18, 2) NOT NULL,
	"withdrawal_total" numeric(18, 2) NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_statement_lines_statement_ord_key" ON "bank_statement_lines" USING btree ("statement_id","ord");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_statement_lines_statement_idx" ON "bank_statement_lines" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_statement_lines_status_idx" ON "bank_statement_lines" USING btree ("statement_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_statement_lines_money_idx" ON "bank_statement_lines" USING btree ("money_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_statements_no_key" ON "bank_statements" USING btree ("no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_statements_account_idx" ON "bank_statements" USING btree ("account_id");