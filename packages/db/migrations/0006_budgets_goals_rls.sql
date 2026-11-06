-- Row-level security for the planning tables (same household isolation as migration 0004).
-- finance_app's privileges on them come from the default privileges set in 0004.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget', 'goal'] LOOP
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
-- default privileges only apply to tables created by the role that set them; grant explicitly too
GRANT SELECT, INSERT, UPDATE, DELETE ON budget, goal TO finance_app;
