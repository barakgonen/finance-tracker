// Budgets, goals and forecasts over data from the real import pipeline, as the restricted app role.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { budget, goal, scoped, type Db } from "@ft/db";
import { addAccount, commitImport, createGoal, createHousehold, setBudget, stageStatement } from "@ft/ingest";
import type { ParsedStatement } from "@ft/parsers";
import { bankStatement, cardStatement, fileFor, row, startHarness, type Harness } from "../../ingest/test/harness.js";
import { budgetSuggestions, budgetsWithStatus, forecastFrom, goalsWithProgress, healthScore, type Filters } from "../src/index.js";

let h: Harness;
const HH = randomUUID();
const OTHER = randomUUID();
const F: Filters = { householdId: HH };
const q = <T>(fn: (tx: Db) => Promise<T>) => scoped(h.appDb, { householdId: HH }, fn);
const load = (s: ParsedStatement, accountId: string) =>
  q(async (tx) => {
    const deps = { db: tx, blobs: h.deps.blobs };
    const p = await stageStatement(deps, { householdId: HH, file: fileFor(s), statement: s, accountId });
    await commitImport(deps, { householdId: HH, importId: p.importId });
  });

beforeAll(async () => {
  h = await startHarness();
  const ids = await q(async (tx) => {
    const { members } = await createHousehold(tx, "t", [{ displayName: "me", role: "admin" }], HH);
    const bank = await addAccount(tx, HH, { type: "bank", institution: "leumi", name: "bank" });
    const card = await addAccount(tx, HH, { type: "credit_card", institution: "cal", name: "card", numberLast4: "1111", ownerMemberId: members[0]!.id });
    return { bank: bank.id, card: card.id };
  });
  const groceries = [280000, 320000, 300000];
  for (const [i, m] of ["07", "08", "09"].entries()) {
    await load(
      cardStatement("cal", "1111", `2026-${m}-28`, [
        row(`2026-${m}-03`, "Spotify P46B9945EB", -2390),
        row(`2026-${m}-10`, "שופרסל דיל", -groceries[i]!),
        row(`2026-${m}-15`, "מסעדה א", -100000),
      ]),
      ids.card,
    );
  }
  await load(bankStatement(["07", "08", "09"].map((m) => row(`2026-${m}-01`, "משכורת", 1000000))), ids.bank);
  await scoped(h.appDb, { householdId: OTHER }, (tx) => createHousehold(tx, "other", [{ displayName: "x", role: "admin" }], OTHER));
});
afterAll(() => h?.stop());

describe("budgets", () => {
  it("reports each budget's state for a finished month, worst first", async () => {
    await q((tx) => setBudget(tx, HH, { categorySlug: "groceries", monthlyLimitMinor: 250000n }));
    await q((tx) => setBudget(tx, HH, { categorySlug: "dining", monthlyLimitMinor: 150000n }));
    const rows = await q((tx) => budgetsWithStatus(tx, F, "2026-09"));
    expect(rows.map((r) => [r.categorySlug, r.status.state, r.status.spentMinor])).toEqual([
      ["groceries", "over", 300000n],
      ["dining", "ok", 100000n],
    ]);
  });

  it("setting a budget again changes it instead of duplicating it", async () => {
    await q((tx) => setBudget(tx, HH, { categorySlug: "groceries", monthlyLimitMinor: 320000n }));
    const rows = await q((tx) => budgetsWithStatus(tx, F, "2026-09"));
    expect(rows.filter((r) => r.categorySlug === "groceries")).toHaveLength(1);
    expect(rows.find((r) => r.categorySlug === "groceries")!.status.state).toBe("near");
  });

  it("suggests limits from the last three months", async () => {
    const s = await q((tx) => budgetSuggestions(tx, F, "2026-10"));
    expect(s.find((x) => x.slug === "groceries")?.suggestedMinor).toBe(300000n);
    expect(s.find((x) => x.slug === "dining")?.suggestedMinor).toBe(100000n);
  });

  it("rejects income categories and non-positive limits", async () => {
    await expect(q((tx) => setBudget(tx, HH, { categorySlug: "salary", monthlyLimitMinor: 1n }))).rejects.toThrow(/spending category/);
    await expect(q((tx) => setBudget(tx, HH, { categorySlug: "dining", monthlyLimitMinor: 0n }))).rejects.toThrow(/positive/);
  });
});

describe("goals", () => {
  it("tracks all three goal types from the ledger", async () => {
    await q((tx) => createGoal(tx, HH, { type: "savings_rate", name: "half", targetRate: 0.5, startMonth: "2026-07" }));
    await q((tx) => createGoal(tx, HH, { type: "save_amount", name: "fund", targetAmountMinor: 5000000n, deadline: "2027-06-30", startMonth: "2026-07" }));
    await q((tx) => createGoal(tx, HH, { type: "reduce_category", name: "less super", categorySlug: "groceries", reducePct: 0.1, baselineMonthlyMinor: 300000n, startMonth: "2026-09" }));
    const goals = await q((tx) => goalsWithProgress(tx, F, "2026-09"));
    const by = Object.fromEntries(goals.map((g) => [g.goal.name, g.progress]));
    expect(by.half).toMatchObject({ state: "achieved" }); // ~60% saved
    expect(by.fund).toMatchObject({ savedMinor: 1792830n }); // 3 x 1,000,000 - (2,390 + 100,000) x 3 - (280,000 + 320,000 + 300,000)
    expect(by["less super"]).toMatchObject({ state: "behind", targetMonthlyMinor: 270000n, currentMonthlyMinor: 300000n });
  });

  it("feeds the health score's goals dimension", async () => {
    const r = await q((tx) => healthScore(tx, F, "2026-09"));
    expect(r.dimensions.find((d) => d.key === "goals")!.score).not.toBeNull();
    expect(r.total).not.toBeNull(); // three complete months
  });

  it("rejects invalid goals", async () => {
    await expect(q((tx) => createGoal(tx, HH, { type: "savings_rate", name: "x", targetRate: 1.5, startMonth: "2026-07" }))).rejects.toThrow(/between/);
    await expect(q((tx) => createGoal(tx, HH, { type: "save_amount", name: "x", targetAmountMinor: 100n, deadline: "2026-06-01", startMonth: "2026-07" }))).rejects.toThrow(/after the start/);
  });

  it("another household sees none of these budgets or goals", async () => {
    const seen = await scoped(h.appDb, { householdId: OTHER }, async (tx) => [...(await tx.select().from(budget)), ...(await tx.select().from(goal))]);
    expect(seen).toEqual([]);
  });
});

describe("forecast", () => {
  it("projects the next months from history, the salary, the subscription and the bank balance", async () => {
    const f = await q((tx) => forecastFrom(tx, F, "2026-09", 3));
    expect(f.status).toBe("ok");
    expect(f.months.map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(f.assumptions.recurringIncomeMinor).toBe(1000000n);
    expect(f.months[0]!.income.mid).toBe(1000000n);
    expect(f.months[0]!.expenses.mid).toBe(402390n); // Spotify + median of the rest (300,000 + 100,000)
    expect(f.months[2]!.balance).not.toBeNull();
  });

  it("shows what a scenario changes", async () => {
    const [base, cut] = await q(async (tx) => [
      await forecastFrom(tx, F, "2026-09", 3),
      await forecastFrom(tx, F, "2026-09", 3, [{ kind: "expense_change", monthlyMinor: -50000n }]),
    ]);
    expect(cut.months[2]!.cumulative.mid - base.months[2]!.cumulative.mid).toBe(150000n);
  });
});
