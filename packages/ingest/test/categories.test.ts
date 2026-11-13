import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { budget, categorizationRule, category, transaction, transactionSplit } from "@ft/db";
import {
  addAccount,
  commitImport,
  correctTransaction,
  createCategory,
  createHousehold,
  deleteCategory,
  ImportError,
  reclassify,
  renameCategory,
  setBudget,
  setSplits,
  stageStatement,
  type IngestDeps,
} from "../src/index.js";
import { cardStatement, fileFor, row, startHarness, type Harness } from "./harness.js";

let h: Harness;
let deps: IngestDeps;
beforeAll(async () => {
  h = await startHarness();
  deps = h.deps;
});
afterAll(() => h?.stop());

let hid: string;
let cardId: string;
const tx = async (agorot: bigint) => (await deps.db.select().from(transaction).where(and(eq(transaction.accountId, cardId), eq(transaction.amount, agorot))))[0]!;
const slugOf = async (id: string | null) => (id ? (await deps.db.select().from(category).where(eq(category.id, id)))[0]!.slug : null);

beforeEach(async () => {
  const { household, members } = await createHousehold(deps.db, "t", [{ displayName: "me", role: "admin" }]);
  hid = household.id;
  cardId = (await addAccount(deps.db, hid, { type: "credit_card", institution: "cal", name: "card", numberLast4: "1111", ownerMemberId: members[0]!.id })).id;
  const s = cardStatement("cal", "1111", "2026-11-02", [row("2026-10-05", "משתלת הגן", -30000), row("2026-10-06", "שופרסל", -50000)]);
  const p = await stageStatement(deps, { householdId: hid, file: fileFor(s), statement: s, accountId: cardId });
  await commitImport(deps, { householdId: hid, importId: p.importId });
});

describe("custom categories", () => {
  it("are created, renamed, and refuse duplicate names and built-in changes", async () => {
    const c = await createCategory(deps.db, { householdId: hid, type: "expense", name: " גינה " });
    expect(c).toMatchObject({ nameHe: "גינה", nameEn: "גינה", isSystem: false, type: "expense" });
    await expect(createCategory(deps.db, { householdId: hid, type: "expense", name: "גינה" })).rejects.toThrow(/already exists/);
    // the same name as a built-in one is taken too
    await expect(createCategory(deps.db, { householdId: hid, type: "expense", name: "Groceries" })).rejects.toThrow(/already exists/);
    await renameCategory(deps.db, { householdId: hid, categoryId: c.id, name: "גינון", nameEn: "Gardening" });
    expect((await deps.db.select().from(category).where(eq(category.id, c.id)))[0]).toMatchObject({ nameHe: "גינון", nameEn: "Gardening" });
    const [groceries] = await deps.db.select().from(category).where(and(eq(category.householdId, hid), eq(category.slug, "groceries")));
    await expect(renameCategory(deps.db, { householdId: hid, categoryId: groceries!.id, name: "x" })).rejects.toThrow(ImportError);
  });

  it("can be used like any category: corrections, rules and re-classification", async () => {
    const c = await createCategory(deps.db, { householdId: hid, type: "expense", name: "גינה" });
    const t = await tx(-30000n);
    await correctTransaction(deps.db, { householdId: hid, transactionId: t.id, category: c.slug, applyToMerchant: true });
    expect(await slugOf((await tx(-30000n)).categoryId)).toBe(c.slug);
    await reclassify(deps.db, hid);
    expect(await slugOf((await tx(-30000n)).categoryId)).toBe(c.slug);
  });

  it("deleting one moves its transactions, splits, rules and budget to another category", async () => {
    const c = await createCategory(deps.db, { householdId: hid, type: "expense", name: "גינה" });
    const t = await tx(-30000n);
    await correctTransaction(deps.db, { householdId: hid, transactionId: t.id, category: c.slug, applyToMerchant: true });
    await setSplits(deps.db, { householdId: hid, transactionId: (await tx(-50000n)).id, parts: [{ amountMinor: 40000n, category: "groceries" }, { amountMinor: 10000n, category: c.slug }] });
    await setBudget(deps.db, hid, { categorySlug: c.slug, monthlyLimitMinor: 50000n });
    await setBudget(deps.db, hid, { categorySlug: "home", monthlyLimitMinor: 90000n });

    await expect(deleteCategory(deps.db, { householdId: hid, categoryId: c.id, moveTo: "salary" })).rejects.toThrow(/same type/);
    const { moved } = await deleteCategory(deps.db, { householdId: hid, categoryId: c.id, moveTo: "home" });
    expect(moved).toBe(1);
    expect(await slugOf((await tx(-30000n)).categoryId)).toBe("home");
    const parts = await deps.db.select().from(transactionSplit).where(eq(transactionSplit.householdId, hid));
    expect((await Promise.all(parts.map((p) => slugOf(p.categoryId)))).sort()).toEqual(["groceries", "home"]);
    const [rule] = await deps.db.select().from(categorizationRule).where(eq(categorizationRule.householdId, hid));
    expect((rule!.actions as { category?: string }).category).toBe("home");
    // home already had a budget: the deleted category's budget is dropped, not doubled
    const budgets = await deps.db.select().from(budget).where(eq(budget.householdId, hid));
    expect(budgets.map((b) => b.monthlyLimit)).toEqual([90000n]);
    expect(await deps.db.select().from(category).where(eq(category.id, c.id))).toEqual([]);
  });
});

describe("splits", () => {
  it("must add up, fit the transaction's side, and have at least two parts", async () => {
    const t = await tx(-50000n);
    const split = (parts: { amountMinor: bigint; category: string | null; member?: string | null }[]) => setSplits(deps.db, { householdId: hid, transactionId: t.id, parts });
    await expect(split([{ amountMinor: 30000n, category: "groceries" }, { amountMinor: 10000n, category: "home" }])).rejects.toThrow(/add up/);
    await expect(split([{ amountMinor: 50000n, category: "groceries" }])).rejects.toThrow(/two parts/);
    await expect(split([{ amountMinor: 40000n, category: "groceries" }, { amountMinor: 10000n, category: "salary" }])).rejects.toThrow(/fit/);
    await expect(split([{ amountMinor: 50001n, category: "groceries" }, { amountMinor: -1n, category: "home" }])).rejects.toThrow(/positive/);

    // a part can't go to someone outside the household
    await expect(split([{ amountMinor: 40000n, category: "groceries" }, { amountMinor: 10000n, category: "home", member: "00000000-0000-0000-0000-000000000000" } as never])).rejects.toThrow(/Member not found/);

    await split([{ amountMinor: 10000n, category: "home" }, { amountMinor: 40000n, category: null }]);
    const parts = await deps.db.select().from(transactionSplit).where(eq(transactionSplit.transactionId, t.id));
    expect(parts.map((p) => p.amount).sort()).toEqual([-40000n, -10000n].sort());
    // labelled with the largest part, and pinned against re-classification
    const after = await tx(-50000n);
    expect(after).toMatchObject({ categoryId: null, isManuallyEdited: true, needsReview: false });

    await split([]);
    expect(await deps.db.select().from(transactionSplit).where(eq(transactionSplit.transactionId, t.id))).toEqual([]);
  });
});
