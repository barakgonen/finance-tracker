CREATE TABLE IF NOT EXISTS "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"email" text,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"token_hash" char(64) NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitation" ADD CONSTRAINT "invitation_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitation" ADD CONSTRAINT "invitation_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_household_member_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_member_idx" ON "invitation" USING btree ("member_id");