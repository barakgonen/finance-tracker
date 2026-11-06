import "server-only";
import { createDb } from "@ft/db";
import { BlobStore, type IngestDeps } from "@ft/ingest";
import { env } from "./env";

// one pool per server process (and per dev-server reload)
const g = globalThis as unknown as { __ftDb?: ReturnType<typeof createDb> };

export function db() {
  g.__ftDb ??= createDb(env.databaseUrl);
  return g.__ftDb.db;
}

export function ingestDeps(): IngestDeps {
  return { db: db(), blobs: new BlobStore(env.blobDir, env.encryptionKey) };
}
