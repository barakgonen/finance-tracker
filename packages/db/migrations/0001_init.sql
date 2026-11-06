CREATE TYPE "public"."account_type" AS ENUM('bank', 'credit_card', 'savings', 'investment', 'cash');--> statement-breakpoint
CREATE TYPE "public"."alias_match" AS ENUM('exact', 'prefix', 'regex');--> statement-breakpoint
CREATE TYPE "public"."category_type" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."classification_source" AS ENUM('manual', 'rule', 'merchant', 'dictionary', 'neighbour', 'ai', 'settlement', 'none');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'parsed', 'failed', 'committed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."tx_kind" AS ENUM('expense', 'income', 'refund', 'reversal', 'internal_transfer', 'card_settlement', 'savings_investment', 'fee', 'cash_withdrawal', 'p2p_transfer', 'loan_payment');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('pending', 'posted');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('shared', 'private');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"type" "account_type" NOT NULL,
	"institution" text NOT NULL,
	"name" text NOT NULL,
	"number_last4" char(4),
	"currency" char(3) DEFAULT 'ILS' NOT NULL,
	"owner_member_id" uuid,
	"visibility" "visibility" DEFAULT 'shared' NOT NULL,
	"settles_to_account_id" uuid,
	"tracks_statements" boolean DEFAULT true NOT NULL,
	"bill_description_pattern" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text,
	"locale" text DEFAULT 'he' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"actor_member_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "balance_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"balance" bigint NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_bill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"card_account_id" uuid NOT NULL,
	"import_file_id" uuid NOT NULL,
	"posting_date" date NOT NULL,
	"total" bigint NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"card_bill_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"day_diff" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_settlement_card_bill_id_unique" UNIQUE("card_bill_id"),
	CONSTRAINT "card_settlement_bank_transaction_id_unique" UNIQUE("bank_transaction_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categorization_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"created_from_correction" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"parent_id" uuid,
	"type" "category_type" NOT NULL,
	"slug" text NOT NULL,
	"name_he" text NOT NULL,
	"name_en" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "household" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_currency" char(3) DEFAULT 'ILS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "household_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid,
	"uploaded_by" uuid,
	"file_name" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"blob_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"institution" text,
	"account_hint" jsonb,
	"parsed" jsonb,
	"parser" text,
	"parser_version" integer,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"reconciliation" jsonb,
	"stats" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_category_id" uuid,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"match" "alias_match" DEFAULT 'exact' NOT NULL,
	"source" "classification_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"import_file_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"raw_row_id" uuid,
	"fingerprint" char(64) NOT NULL,
	"purchase_date" date NOT NULL,
	"posting_date" date,
	"amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'ILS' NOT NULL,
	"original_amount" bigint,
	"original_currency" char(3),
	"description_raw" text NOT NULL,
	"description_norm" text NOT NULL,
	"category_hint" text,
	"type_hint" text,
	"merchant_id" uuid,
	"category_id" uuid,
	"kind" "tx_kind" DEFAULT 'expense' NOT NULL,
	"status" "tx_status" DEFAULT 'posted' NOT NULL,
	"installment_no" integer,
	"installment_total" integer,
	"installment_original_amount" bigint,
	"member_id" uuid,
	"is_shared" boolean DEFAULT false NOT NULL,
	"classification_source" "classification_source" DEFAULT 'none' NOT NULL,
	"classification_confidence" real,
	"classification_reason" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"is_manually_edited" boolean DEFAULT false NOT NULL,
	"superseded_by_id" uuid,
	"settlement_group_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transaction_split" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"category_id" uuid,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_owner_member_id_household_member_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_settles_to_account_id_account_id_fk" FOREIGN KEY ("settles_to_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_member_id_household_member_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_bill" ADD CONSTRAINT "card_bill_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_bill" ADD CONSTRAINT "card_bill_card_account_id_account_id_fk" FOREIGN KEY ("card_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_bill" ADD CONSTRAINT "card_bill_import_file_id_import_file_id_fk" FOREIGN KEY ("import_file_id") REFERENCES "public"."import_file"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_settlement" ADD CONSTRAINT "card_settlement_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_settlement" ADD CONSTRAINT "card_settlement_card_bill_id_card_bill_id_fk" FOREIGN KEY ("card_bill_id") REFERENCES "public"."card_bill"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_settlement" ADD CONSTRAINT "card_settlement_bank_transaction_id_transaction_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."transaction"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "categorization_rule" ADD CONSTRAINT "categorization_rule_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "category" ADD CONSTRAINT "category_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "household_member" ADD CONSTRAINT "household_member_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "household_member" ADD CONSTRAINT "household_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_file" ADD CONSTRAINT "import_file_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_file" ADD CONSTRAINT "import_file_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_file" ADD CONSTRAINT "import_file_uploaded_by_household_member_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant" ADD CONSTRAINT "merchant_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant" ADD CONSTRAINT "merchant_default_category_id_category_id_fk" FOREIGN KEY ("default_category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant" ADD CONSTRAINT "merchant_merged_into_id_merchant_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."merchant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_alias" ADD CONSTRAINT "merchant_alias_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_alias" ADD CONSTRAINT "merchant_alias_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_row" ADD CONSTRAINT "raw_row_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_row" ADD CONSTRAINT "raw_row_import_file_id_import_file_id_fk" FOREIGN KEY ("import_file_id") REFERENCES "public"."import_file"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_raw_row_id_raw_row_id_fk" FOREIGN KEY ("raw_row_id") REFERENCES "public"."raw_row"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_superseded_by_id_transaction_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."transaction"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_split" ADD CONSTRAINT "transaction_split_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_split" ADD CONSTRAINT "transaction_split_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_split" ADD CONSTRAINT "transaction_split_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_split" ADD CONSTRAINT "transaction_split_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_bill_uq" ON "card_bill" USING btree ("card_account_id","posting_date","total");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "category_slug_uq" ON "category" USING btree ("household_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "household_member_user_uq" ON "household_member" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_file_sha_uq" ON "import_file" USING btree ("household_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_alias_uq" ON "merchant_alias" USING btree ("household_id","pattern","match");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raw_row_file_idx_uq" ON "raw_row" USING btree ("import_file_id","row_index");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transaction_fingerprint_uq" ON "transaction" USING btree ("account_id","fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_hh_date_idx" ON "transaction" USING btree ("household_id","purchase_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_hh_cat_date_idx" ON "transaction" USING btree ("household_id","category_id","purchase_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_hh_merchant_date_idx" ON "transaction" USING btree ("household_id","merchant_id","purchase_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_desc_trgm_idx" ON "transaction" USING gin ("description_norm" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_review_idx" ON "transaction" USING btree ("household_id","needs_review");