CREATE TABLE IF NOT EXISTS "money_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"ord" serial NOT NULL,
	"no" text NOT NULL,
	"date" date NOT NULL,
	"from_account_id" text NOT NULL,
	"from_account" text NOT NULL,
	"to_account_id" text NOT NULL,
	"to_account" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"charge" numeric(18, 2) NOT NULL,
	"reference" text,
	"note" text,
	"process" text NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"history" jsonb,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "money_transfers_process_check" CHECK ("process" in ('Created','Approved','Cancelled')),
	CONSTRAINT "money_transfers_pair_check" CHECK ("from_account_id" <> "to_account_id"),
	CONSTRAINT "money_transfers_amount_check" CHECK ("amount" > 0 and "charge" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cheque_events" (
	"id" text PRIMARY KEY NOT NULL,
	"cheque_id" text NOT NULL,
	"action" text NOT NULL,
	"date" date NOT NULL,
	"reason" text,
	"by" text NOT NULL,
	"at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "cheque_events_action_check" CHECK ("action" in ('presented','cleared','bounced'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "money_transfers_no_key" ON "money_transfers" USING btree ("no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "money_transfers_live_idx" ON "money_transfers" USING btree ("created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "money_transfers_date_idx" ON "money_transfers" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "money_transfers_accounts_idx" ON "money_transfers" USING btree ("from_account_id","to_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cheque_events_cheque_idx" ON "cheque_events" USING btree ("cheque_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cheque_events_at_idx" ON "cheque_events" USING btree ("at");
