import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

/** A database handle or an open transaction: both expose the same query API. */
export type Db = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

export async function runMigrations(db: Db): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
  await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
}
