DROP INDEX IF EXISTS "raw_row_file_idx_uq";--> statement-breakpoint
ALTER TABLE "raw_row" ADD COLUMN "parser_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- existing rows came from their import's parser version, not necessarily 1
UPDATE "raw_row" r SET "parser_version" = COALESCE(f."parser_version", 1) FROM "import_file" f WHERE f."id" = r."import_file_id";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raw_row_file_version_uq" ON "raw_row" USING btree ("import_file_id","row_index","parser_version");