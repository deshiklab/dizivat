CREATE TABLE IF NOT EXISTS "gl_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"group" text NOT NULL,
	"money_account_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	CONSTRAINT "gl_accounts_kind_check" CHECK ("kind" in ('asset','liability','equity','revenue','expense'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"date" date NOT NULL,
	"memo" text NOT NULL,
	"lines" jsonb NOT NULL,
	"process" text NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "journal_entries_process_check" CHECK ("process" in ('Created','Approved','Cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gl_accounts_code_key" ON "gl_accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gl_accounts_money_idx" ON "gl_accounts" USING btree ("money_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_no_key" ON "journal_entries" USING btree ("no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_entries_live_idx" ON "journal_entries" USING btree ("created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_entries_date_idx" ON "journal_entries" USING btree ("date");
