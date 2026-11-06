// Kept apart from the main entry: it locates the migrations folder relative to this file,
// which only works when loaded from disk (tests, the CLI), not from an app bundle.
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db } from "./index.js";

export async function runMigrations(db: Db): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
  await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
}
