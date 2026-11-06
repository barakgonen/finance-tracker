-- Row-level security: every household table is visible and writable only for the household set
-- in the current transaction (SET LOCAL via set_config(..., true)). The app connects as the
-- restricted role finance_app, which is neither superuser, table owner, nor BYPASSRLS, so the
-- policies always apply to it. Without the setting, queries see nothing (fail closed).
--
-- The login password for finance_app is set outside migrations (see `pnpm --filter @ft/db migrate`
-- with APP_DB_PASSWORD), so no secret lives in this file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finance_app') THEN
    CREATE ROLE finance_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO finance_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO finance_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finance_app;
--> statement-breakpoint

-- the household id for this transaction, or NULL when unset (current_setting returns '' after a
-- transaction-local setting ends, hence the nullif)
CREATE OR REPLACE FUNCTION app_household_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.household_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_invite_token_hash() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.invite_token_hash', true), '') $$;
--> statement-breakpoint

-- household-scoped tables: one policy each, for reads and writes alike
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account', 'import_file', 'raw_row', 'category', 'merchant', 'merchant_alias', 'transaction',
    'transaction_split', 'categorization_rule', 'card_bill', 'card_settlement', 'balance_snapshot',
    'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS household_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY household_isolation ON %I USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

ALTER TABLE household ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE household FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY household_isolation ON household USING (id = app_household_id()) WITH CHECK (id = app_household_id());
--> statement-breakpoint

-- members: the household's own rows, plus a signed-in user's own membership row (that is how a
-- request finds its household in the first place)
ALTER TABLE household_member ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE household_member FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY household_isolation ON household_member
  USING (household_id = app_household_id() OR user_id = app_user_id())
  WITH CHECK (household_id = app_household_id());
--> statement-breakpoint

-- invitations: the household's own, plus the single invite whose token the visitor presented
ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY household_isolation ON invitation
  USING (household_id = app_household_id() OR token_hash = app_invite_token_hash())
  WITH CHECK (household_id = app_household_id());
