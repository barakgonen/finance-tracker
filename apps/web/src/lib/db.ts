import "server-only";
import { createDb, scoped, type Db, type Scope } from "@ft/db";
import { BlobStore, type IngestDeps } from "@ft/ingest";
import { env } from "./env";

// one pool per server process (and per dev-server reload). DATABASE_URL must be the restricted
// finance_app role so row-level security applies; migrations use a separate admin URL.
const g = globalThis as unknown as { __ftDb?: ReturnType<typeof createDb> };

/** The unscoped pool: only for tables outside row-level security (users, sessions). */
export function db(): Db {
  g.__ftDb ??= createDb(env.databaseUrl);
  return g.__ftDb.db;
}

/** Runs `fn` in a transaction that can see one household's rows (or a user's / invite's, see Scope). */
export function scope<T>(s: Scope, fn: (tx: Db) => Promise<T>): Promise<T> {
  return scoped(db(), s, fn);
}

export function ingestDeps(tx: Db): IngestDeps {
  return { db: tx, blobs: new BlobStore(env.blobDir, env.encryptionKey) };
}
