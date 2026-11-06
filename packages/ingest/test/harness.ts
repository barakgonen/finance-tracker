import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb } from "@ft/db";
import { runMigrations } from "@ft/db/migrate";
import type { ParsedStatement, ParsedTransaction } from "@ft/parsers";
import { BlobStore, type IngestDeps } from "../src/index.js";

export interface Harness {
  deps: IngestDeps;
  stop: () => Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:17").start();
  const { db, close } = createDb(container.getConnectionUri());
  await runMigrations(db);
  const blobs = new BlobStore(mkdtempSync(join(tmpdir(), "ft-blobs-")), randomBytes(32));
  return {
    deps: { db, blobs },
    stop: async () => {
      await close();
      await container.stop();
    },
  };
}

// --- synthetic statements ---

let seq = 0;
export const row = (purchaseDate: string, description: string, agorot: number, extra: Partial<ParsedTransaction> = {}): ParsedTransaction => ({
  rowIndex: seq++,
  raw: { description },
  purchaseDate,
  description,
  amount: { minor: BigInt(agorot), currency: "ILS" },
  status: "posted",
  ...extra,
});

export function cardStatement(institution: string, last4: string | undefined, postingDate: string, rows: ParsedTransaction[], printedTotal?: number): ParsedStatement {
  const rs = rows.map((r, i) => ({ ...r, rowIndex: i }));
  // like real statements, the bill covers posted rows only
  const posted = rs.filter((r) => r.status === "posted");
  const total = printedTotal ?? -posted.reduce((a, r) => a + Number(r.amount.minor), 0);
  return {
    adapter: "test-card",
    adapterVersion: 1,
    account: { type: "credit_card", institution, cardLast4: last4 },
    transactions: rs,
    totals: [{ label: `bill ${postingDate}`, postingDate, amount: { minor: BigInt(total), currency: "ILS" }, rowIndices: posted.map((r) => r.rowIndex) }],
    warnings: [],
  };
}

/** Rows newest-first like a bank export, with a consistent running balance. */
export function bankStatement(rows: ParsedTransaction[], openingAgorot = 1_000_000): ParsedStatement {
  const oldestFirst = [...rows].sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));
  let balance = BigInt(openingAgorot);
  const withBalance = oldestFirst.map((r) => {
    balance += r.amount.minor;
    return { ...r, balance: { minor: balance, currency: "ILS" } };
  });
  const rs = withBalance.reverse().map((r, i) => ({ ...r, rowIndex: i }));
  const closingBalance = { asOf: oldestFirst[oldestFirst.length - 1]!.purchaseDate, balance: { minor: balance, currency: "ILS" } };
  return { adapter: "test-bank", adapterVersion: 1, account: { type: "bank", institution: "leumi" }, transactions: rs, totals: [], closingBalance, warnings: [] };
}

/** File bytes for a statement; `salt` makes otherwise-identical uploads distinct files. */
export function fileFor(statement: ParsedStatement, salt = "") {
  const text = JSON.stringify(statement, (_, v) => (typeof v === "bigint" ? v.toString() : v)) + salt;
  return { fileName: `${statement.adapter}-${seq++}.json`, bytes: new TextEncoder().encode(text) };
}
