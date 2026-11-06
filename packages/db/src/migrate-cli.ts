// `pnpm --filter @ft/db migrate`: applies pending migrations to DATABASE_URL (an owner/admin role).
// With APP_DB_PASSWORD set, also enables login for the restricted finance_app role the app uses.
import { sql } from "drizzle-orm";
import { createDb } from "./index.js";
import { runMigrations } from "./migrate.js";

const { db, close } = createDb(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);
try {
  await runMigrations(db);
  console.log("Migrations applied");
  const password = process.env.APP_DB_PASSWORD;
  if (password) {
    // ALTER ROLE takes no bind parameters. With standard_conforming_strings (the default since
    // PostgreSQL 9.1) doubling single quotes is the complete escaping rule for a literal.
    if (password.includes("\0")) throw new Error("APP_DB_PASSWORD contains a NUL byte");
    await db.execute(sql.raw(`ALTER ROLE finance_app LOGIN PASSWORD '${password.replace(/'/g, "''")}'`));
    console.log("finance_app login enabled");
  }
} finally {
  await close();
}
