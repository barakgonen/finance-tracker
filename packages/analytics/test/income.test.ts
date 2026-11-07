// Income is money coming in: a salary month counts only the deposits, never money going out.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { scoped, transaction, type Db } from "@ft/db";
import { addAccount, commitImport, correctTransaction, createHousehold, ImportError, stageStatement } from "@ft/ingest";
import { bankStatement, fileFor, row, startHarness, type Harness } from "../../ingest/test/harness.js";
import { cashFlow, categoryBreakdown, listTransactions, monthTotals } from "../src/index.js";

let h: Harness;
const HH = randomUUID();
const q = <T>(fn: (tx: Db) => Promise<T>) => scoped(h.appDb, { householdId: HH }, fn);
const F = { householdId: HH };
let bankId: string;

beforeAll(async () => {
  h = await startHarness();
  bankId = await q(async (tx) => {
    await createHousehold(tx, "t", [{ displayName: "me", role: "admin" }], HH);
    return (await addAccount(tx, HH, { type: "bank", institution: "leumi", name: "bank" })).id;
  });
  const s = bankStatement([row("2026-10-10", "משכורת", 1500000), row("2026-10-12", "חברה כלשהי בעמ-י", -20000)]);
  await q(async (tx) => {
    const deps = { db: tx, blobs: h.deps.blobs };
    const p = await stageStatement(deps, { householdId: HH, file: fileFor(s), statement: s, accountId: bankId });
    await commitImport(deps, { householdId: HH, importId: p.importId });
  });
});
afterAll(() => h?.stop());

const payment = () => q(async (tx) => (await tx.select().from(transaction).where(and(eq(transaction.accountId, bankId), eq(transaction.amount, -20000n))))[0]!);

describe("income", () => {
  it("refuses to mark outgoing money as income", async () => {
    const p = await payment();
    await expect(q((tx) => correctTransaction(tx as never, { householdId: HH, transactionId: p.id, kind: "income" }))).rejects.toThrow(ImportError);
    await expect(q((tx) => correctTransaction(tx as never, { householdId: HH, transactionId: p.id, kind: "expense", category: "salary" }))).rejects.toThrow(/coming in/);
  });

  it("counts an outgoing row stored as income as spending, not as negative income", async () => {
    // e.g. edited before the rule existed
    await h.deps.db.update(transaction).set({ kind: "income" }).where(eq(transaction.id, (await payment()).id));
    const t = await q((tx) => monthTotals(tx, F, "2026-10"));
    expect(t.incomeMinor).toBe(1500000n);
    expect(t.expensesMinor).toBe(20000n);
    const [flow] = await q((tx) => cashFlow(tx, F, "2026-10", "2026-10"));
    expect(flow).toMatchObject({ incomeMinor: 1500000n, spendingMinor: 20000n });
    const income = await q((tx) => listTransactions(tx, F, { from: "2026-10-01", to: "2026-11-01", side: "income" }));
    expect(income.rows.map((r) => r.amount)).toEqual([1500000n]);
    const byCategory = await q((tx) => categoryBreakdown(tx, F, "2026-10", "income"));
    expect(byCategory.reduce((a, c) => a + c.minor, 0n)).toBe(1500000n);
  });
});
