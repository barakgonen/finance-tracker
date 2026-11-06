// `pnpm --filter @ft/db migrate`: applies pending migrations to DATABASE_URL.
import { createDb } from "./index.js";
import { runMigrations } from "./migrate.js";

const { db, close } = createDb();
try {
  await runMigrations(db);
  console.log("Migrations applied");
} finally {
  await close();
}
