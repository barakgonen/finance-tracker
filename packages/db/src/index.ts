import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
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

/** What a transaction is allowed to see under row-level security (see migration 0004). */
export interface Scope {
  householdId?: string;
  /** lets a signed-in user find their own membership row before the household is known */
  userId?: string;
  /** lets an invite link's holder read that one invitation */
  inviteTokenHash?: string;
}

/**
 * Runs `fn` in a transaction scoped by row-level security. The settings are transaction-local
 * (set_config(..., true)), so they can never leak to another request through the connection pool.
 */
export async function scoped<T>(db: Db, scope: Scope, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await applyScope(tx, scope);
    return fn(tx);
  });
}

/** Adds to the scope of an open transaction (e.g. once an invite reveals its household). */
export async function applyScope(tx: Db, scope: Scope): Promise<void> {
  const settings: [string, string | undefined][] = [
    ["app.household_id", scope.householdId],
    ["app.user_id", scope.userId],
    ["app.invite_token_hash", scope.inviteTokenHash],
  ];
  for (const [key, value] of settings) {
    if (value !== undefined) await tx.execute(sql`select set_config(${key}, ${value}, true)`);
  }
}
