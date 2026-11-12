// A split transaction counts in each part's category, and every figure still adds up.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { scoped, transaction, type Db } from "@ft/db";
import { addAccount, commitImport, createCategory, createHousehold, setBudget, setSplits, stageStatement } from "@ft/ingest";
import { cardStatement, fileFor, row, startHarness, type Harness } from "../../ingest/test/harness.js";
import { budgetsWithStatus, categoryBreakdown, listTransactions, monthTotals } from "../src/index.js";

let h: Harness;
const HH = randomUUID();
const q = <T>(fn: (tx: Db) => Promise<T>) => scoped(h.appDb, { householdId: HH }, fn);
const F = { householdId: HH };
const OCT = { from: "2026-10-01", to: "2026-11-01" };
let cardId: string;
let gardenSlug: string;

beforeAll(async () => {
  h = await startHarness();
  cardId = await q(async (tx) => {
    const { members } = await createHousehold(tx, "t", [{ displayName: "me", role: "admin" }], HH);
    return (await addAccount(tx, HH, { type: "credit_card", institution: "cal", name: "card", numberLast4: "1111", ownerMemberId: members[0]!.id })).id;
  });
  const s = cardStatement("cal", "1111", "2026-11-02", [row("2026-10-05", "שופרסל", -50000), row("2026-10-08", "WOLT", -10000)]);
  await q(async (tx) => {
    const deps = { db: tx, blobs: h.deps.blobs };
    const p = await stageStatement(deps, { householdId: HH, file: fileFor(s), statement: s, accountId: cardId });
    await commitImport(deps, { householdId: HH, importId: p.importId });
    gardenSlug = (await createCategory(tx, { householdId: HH, type: "expense", name: "גינה" })).slug;
  });
  // the ₪500 supermarket bill was ₪350 groceries and ₪150 for the garden
  const sup = await q(async (tx) => (await tx.select().from(transaction).where(and(eq(transaction.accountId, cardId), eq(transaction.amount, -50000n))))[0]!);
  await q((tx) =>
    setSplits(tx as never, { householdId: HH, transactionId: sup.id, parts: [{ amountMinor: 35000n, category: "groceries" }, { amountMinor: 15000n, category: gardenSlug }] }),
  );
  await q((tx) => setBudget(tx, HH, { categorySlug: gardenSlug, monthlyLimitMinor: 20000n }));
});
afterAll(() => h?.stop());

describe("split transactions", () => {
  it("count each part in its category; the month's total is unchanged", async () => {
    const cats = await q((tx) => categoryBreakdown(tx, F, "2026-10"));
    const by = new Map(cats.map((c) => [c.slug, c.minor]));
    expect(by.get("groceries")).toBe(35000n);
    expect(by.get(gardenSlug)).toBe(15000n);
    const total = await q((tx) => monthTotals(tx, F, "2026-10"));
    expect(total.expensesMinor).toBe(60000n);
    expect(cats.reduce((a, c) => a + c.minor, 0n)).toBe(total.expensesMinor);
    expect(cats.find((c) => c.slug === "groceries")!.count).toBe(1);
  });

  it("a category's drill-down shows the part and adds up to the category", async () => {
    const garden = await q((tx) => listTransactions(tx, F, { ...OCT, side: "spending", category: gardenSlug }));
    expect(garden.rows).toHaveLength(1);
    expect(garden.rows[0]).toMatchObject({ description: "שופרסל", amount: -15000n, isSplitPart: true });
    expect(garden.totalMinor).toBe(-15000n);
    // without a category filter the transaction is listed once, whole
    const all = await q((tx) => listTransactions(tx, F, { ...OCT, side: "spending" }));
    expect(all.rows.map((r) => r.amount).sort()).toEqual([-50000n, -10000n].sort());
    expect(all.totalMinor).toBe(-60000n);
  });

  it("budgets count the part in their category", async () => {
    const [b] = await q((tx) => budgetsWithStatus(tx, F, "2026-10"));
    expect(b!.status.spentMinor).toBe(15000n);
  });
});
