ALTER TABLE "transaction" ADD COLUMN "card_bill_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_card_bill_id_card_bill_id_fk" FOREIGN KEY ("card_bill_id") REFERENCES "public"."card_bill"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_card_bill_idx" ON "transaction" USING btree ("card_bill_id");
--> statement-breakpoint
-- existing rows: an import that printed a single bill itemizes exactly that bill (imports with
-- several bills are tied on their next re-processing)
UPDATE "transaction" t SET "card_bill_id" = b."id"
FROM "raw_row" r, "card_bill" b
WHERE t."raw_row_id" = r."id" AND b."import_file_id" = r."import_file_id" AND b."card_account_id" = t."account_id"
  AND t."card_bill_id" IS NULL
  AND (SELECT count(*) FROM "card_bill" b2 WHERE b2."import_file_id" = b."import_file_id") = 1;
