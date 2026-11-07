-- Row-level security for insight states (same household isolation as migration 0004).
ALTER TABLE insight_state ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE insight_state FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY household_isolation ON insight_state USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON insight_state TO finance_app;
