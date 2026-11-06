// Analytics over data that went through the real import pipeline, queried as the restricted app
// role. The figures are small round numbers so every expectation can be checked by hand.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scoped, type Db } from "@ft/db";
import { addAccount, commitImport, createHousehold, stageStatement } from "@ft/ingest";
import type { ParsedStatement } from "@ft/parsers";
import { bankStatement, cardStatement, fileFor, row, startHarness, type Harness } from "../../ingest/test/harness.js";
import {
  cashFlow,
  categoryBreakdown,
  dailySpending,
  incomeStability,
  largestTransactions,
  listTransactions,
  merchantBreakdown,
  monthlySeries,
  monthTotals,
  UNCATEGORIZED,
  type Filters,
} from "../src/index.js";

let h: Harness;
const HH = randomUUID();
let me: string;
let partner: string;
const F = (): Filters => ({ householdId: HH });
const q = <T>(fn: (tx: Db) => Promise<T>) => scoped(h.appDb, { householdId: HH }, fn);

beforeAll(async () => {
  h = await startHarness();
  const ids = await q(async (tx) => {
    const { members } = await createHousehold(tx, "t", [{ displayName: "me", role: "admin" }, { displayName: "partner" }], HH);
    const bank = await addAccount(tx, HH, { type: "bank", institution: "leumi", name: "bank" });
    const card = await addAccount(tx, HH, { type: "credit_card", institution: "cal", name: "card", numberLast4: "1111", ownerMemberId: members[0]!.id, settlesToAccountId: bank.id });
    return { me: members[0]!.id, partner: members[1]!.id, bank: bank.id, card: card.id };
  });
  me = ids.me;
  partner = ids.partner;

  const load = (s: ParsedStatement, accountId: string) =>
    q(async (tx) => {
      const deps = { db: tx, blobs: h.deps.blobs };
      const p = await stageStatement(deps, { householdId: HH, file: fileFor(s), statement: s, accountId });
      await commitImport(deps, { householdId: HH, importId: p.importId });
    });

  // card (mine): three months of history, then October
  await load(cardStatement("cal", "1111", "2026-08-02", [row("2026-07-05", "שופרסל", -40000), row("2026-07-06", "WOLT", -10000)]), ids.card);
  await load(cardStatement("cal", "1111", "2026-09-02", [row("2026-08-05", "שופרסל", -60000), row("2026-08-06", "WOLT", -20000)]), ids.card);
  await load(cardStatement("cal", "1111", "2026-10-02", [row("2026-09-05", "שופרסל", -50000)]), ids.card);
  await load(
    cardStatement("cal", "1111", "2026-10-28", [
      row("2026-10-03", "שופרסל", -30000),
      row("2026-10-04", "WOLT", -15000),
      row("2026-10-09", "WOLT", 5000, { typeHint: "זיכוי" }),
      row("2026-10-12", "מקום לא מוכר", -7000),
      row("2026-10-20", "ARCAFFE", -999, { status: "pending" }),
    ]),
    ids.card,
  );
  // bank (shared): salary, a deposit to savings, a Bit transfer, and the October card bill
  await load(
    bankStatement([
      row("2026-10-01", "משכורת", 1000000),
      row("2026-10-10", "פיקדון*", -200000),
      row("2026-10-15", "הפועלים-ביט", -30000),
      row("2026-10-28", "כרטיסי אשראי-י", -47000),
    ]),
    ids.bank,
  );
});
afterAll(() => h?.stop());

describe("month totals", () => {
  it("counts income and spending only: savings, transfers, card bills and pending rows are excluded; refunds offset", async () => {
    const t = await q((tx) => monthTotals(tx, F(), "2026-10"));
    expect(t).toMatchObject({
      incomeMinor: 1000000n,
      expensesMinor: 47000n, // 30000 + 15000 - 5000 + 7000
      netMinor: 953000n,
      unreviewedExpensesMinor: 7000n, // the unknown merchant is a guess
      unreviewedCount: 1,
    });
  });

  it("the monthly series is zero-filled and matches the single-month totals", async () => {
    const s = await q((tx) => monthlySeries(tx, F(), "2026-06", "2026-10"));
    expect(s.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(s.map((m) => m.expensesMinor)).toEqual([0n, 50000n, 80000n, 50000n, 47000n]);
  });

  it("the individual view only counts that member's transactions", async () => {
    const mine = await q((tx) => monthTotals(tx, { householdId: HH, memberId: me }, "2026-10"));
    expect(mine).toMatchObject({ expensesMinor: 47000n, incomeMinor: 0n }); // salary landed in the shared account
    const theirs = await q((tx) => monthTotals(tx, { householdId: HH, memberId: partner }, "2026-10"));
    expect(theirs).toMatchObject({ expensesMinor: 0n, incomeMinor: 0n });
  });
});

describe("categories", () => {
  it("breaks spending down with last month and the 3-month average", async () => {
    const cats = await q((tx) => categoryBreakdown(tx, F(), "2026-10"));
    const by = Object.fromEntries(cats.map((c) => [c.slug, c]));
    expect(by.groceries).toMatchObject({ minor: 30000n, prevMinor: 50000n, avg3Minor: 50000n }); // (400+600+500)/3
    expect(by.delivery).toMatchObject({ minor: 10000n, prevMinor: 0n, avg3Minor: 10000n }); // refund offsets; (100+200+0)/3
    expect(by[UNCATEGORIZED]).toMatchObject({ minor: 7000n });
  });

  it("adds up to the month's spending, and each drill-down list adds up to its category", async () => {
    const [cats, totals] = await q(async (tx) => [await categoryBreakdown(tx, F(), "2026-10"), await monthTotals(tx, F(), "2026-10")] as const);
    expect(cats.reduce((a, c) => a + c.minor, 0n)).toBe(totals.expensesMinor);
    for (const c of cats) {
      const list = await q((tx) => listTransactions(tx, F(), { from: "2026-10-01", to: "2026-11-01", side: "spending", category: c.slug }));
      expect(-list.totalMinor, c.slug).toBe(c.minor);
    }
  });

  it("has no average without history instead of inventing one", async () => {
    const cats = await q((tx) => categoryBreakdown(tx, F(), "2026-07"));
    expect(cats.every((c) => c.avg3Minor === null)).toBe(true);
  });

  it("breaks income down by category too", async () => {
    const cats = await q((tx) => categoryBreakdown(tx, F(), "2026-10", "income"));
    expect(cats).toMatchObject([{ slug: "salary", minor: 1000000n, share: 1 }]);
  });
});

describe("merchants, time and large transactions", () => {
  it("ranks merchants by net spending with count, average and last month", async () => {
    const m = await q((tx) => merchantBreakdown(tx, F(), "2026-10"));
    expect(m.map((r) => [r.name, r.minor, r.count, r.avgMinor])).toEqual([
      ["שופרסל", 30000n, 1, 30000n],
      ["WOLT", 10000n, 2, 5000n],
      ["מקום לא מוכר", 7000n, 1, 7000n],
    ]);
    // drill-down parity for a merchant
    const wolt = m.find((r) => r.name === "WOLT")!;
    const list = await q((tx) => listTransactions(tx, F(), { from: "2026-10-01", to: "2026-11-01", side: "spending", merchantId: wolt.merchantId }));
    expect(-list.totalMinor).toBe(wolt.minor);
  });

  it("daily spending covers every day of the month and sums to the month", async () => {
    const days = await q((tx) => dailySpending(tx, F(), "2026-10"));
    expect(days.length).toBe(31);
    expect(days.reduce((a, d) => a + d.minor, 0n)).toBe(47000n);
    expect(days.find((d) => d.date === "2026-10-09")!.minor).toBe(-5000n); // a refund day is negative
  });

  it("lists the largest transactions first", async () => {
    const top = await q((tx) => largestTransactions(tx, F(), "2026-10", 2));
    expect(top.map((t) => t.description)).toEqual(["משכורת", "שופרסל"]);
  });
});

describe("cash flow", () => {
  it("separates income, spending, savings, transfers and card bills", async () => {
    const [oct] = await q((tx) => cashFlow(tx, F(), "2026-10", "2026-10"));
    expect(oct).toMatchObject({
      incomeMinor: 1000000n,
      spendingMinor: 47000n,
      savedMinor: 200000n,
      transfersMinor: -30000n,
      cardBillsMinor: 47000n, // matched to the card statement, so not spending
      netMinor: 953000n,
    });
  });
});

describe("income stability", () => {
  it("is 0 for identical months, grows with variation, and needs three months", () => {
    expect(incomeStability([100n, 100n, 100n])).toBe(0);
    expect(incomeStability([100n, 200n, 300n])).toBeCloseTo(0.408, 2);
    expect(incomeStability([100n, 0n, 100n])).toBeNull();
  });
});

describe("health score", () => {
  it("needs three complete months before giving an overall score", async () => {
    const { healthScore } = await import("../src/index.js");
    // this household has income only in October
    const r = await q((tx) => healthScore(tx, F(), "2026-10"));
    expect(r).toMatchObject({ total: null, insufficient: "too_few_months", monthsUsed: 1 });
    expect(r.dimensions.find((d) => d.key === "emergency_fund")!.score).not.toBeNull(); // the bank balance is known
  });
});
