// A purchase split between people: each member's view counts only that member's part, everywhere.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { scoped, transaction, type Db } from "@ft/db";
import { addAccount, commitImport, createHousehold, setBudget, setSplits, stageStatement } from "@ft/ingest";
import { cardStatement, fileFor, row, startHarness, type Harness } from "../../ingest/test/harness.js";
import { budgetsWithStatus, cashFlow, categoryBreakdown, largestTransactions, listTransactions, merchantBreakdown, monthTotals } from "../src/index.js";

let h: Harness;
const HH = randomUUID();
const q = <T>(fn: (tx: Db) => Promise<T>) => scoped(h.appDb, { householdId: HH }, fn);
let me: string;
let partner: string;
const OCT = { from: "2026-10-01", to: "2026-11-01" };

beforeAll(async () => {
  h = await startHarness();
  const ids = await q(async (tx) => {
    const { members } = await createHousehold(tx, "t", [{ displayName: "me", role: "admin" }, { displayName: "partner" }], HH);
    // a card in my name
    const card = await addAccount(tx, HH, { type: "credit_card", institution: "cal", name: "card", numberLast4: "1111", ownerMemberId: members[0]!.id });
    return { me: members[0]!.id, partner: members[1]!.id, card: card.id };
  });
  me = ids.me;
  partner = ids.partner;
  const s = cardStatement("cal", "1111", "2026-11-02", [row("2026-10-05", "קניון עזריאלי", -60000), row("2026-10-08", "WOLT", -10000)]);
  await q(async (tx) => {
    const deps = { db: tx, blobs: h.deps.blobs };
    const p = await stageStatement(deps, { householdId: HH, file: fileFor(s), statement: s, accountId: ids.card });
    await commitImport(deps, { householdId: HH, importId: p.importId });
  });
  const mall = await q(async (tx) => (await tx.select().from(transaction).where(and(eq(transaction.householdId, HH), eq(transaction.amount, -60000n))))[0]!);
  // ₪400 groceries for me, ₪200 clothes for my partner
  await q((tx) =>
    setSplits(tx as never, {
      householdId: HH,
      transactionId: mall.id,
      parts: [
        { amountMinor: 40000n, category: "groceries", member: me },
        { amountMinor: 20000n, category: "clothing", member: partner },
      ],
    }),
  );
  await q((tx) => setBudget(tx, HH, { categorySlug: "clothing", monthlyLimitMinor: 50000n, memberId: partner }));
});
afterAll(() => h?.stop());

const asHousehold = () => ({ householdId: HH });
const asMember = (memberId: string) => ({ householdId: HH, memberId });

describe("a purchase split between people", () => {
  it("leaves the household totals as they were", async () => {
    expect((await q((tx) => monthTotals(tx, asHousehold(), "2026-10"))).expensesMinor).toBe(70000n);
  });

  it("counts each member's part in that member's totals, categories and cash flow", async () => {
    expect((await q((tx) => monthTotals(tx, asMember(me), "2026-10"))).expensesMinor).toBe(40000n + 10000n);
    expect((await q((tx) => monthTotals(tx, asMember(partner), "2026-10"))).expensesMinor).toBe(20000n);
    const partnerCats = await q((tx) => categoryBreakdown(tx, asMember(partner), "2026-10"));
    expect(partnerCats.map((c) => [c.slug, c.minor])).toEqual([["clothing", 20000n]]);
    const myCats = new Map((await q((tx) => categoryBreakdown(tx, asMember(me), "2026-10"))).map((c) => [c.slug, c.minor]));
    expect(myCats.get("groceries")).toBe(40000n);
    expect(myCats.has("clothing")).toBe(false);
    const [flow] = await q((tx) => cashFlow(tx, asMember(partner), "2026-10", "2026-10"));
    expect(flow!.spendingMinor).toBe(20000n);
  });

  it("lists, ranks and budgets by the member's part", async () => {
    const list = await q((tx) => listTransactions(tx, asMember(partner), { ...OCT, side: "spending" }));
    expect(list.rows.map((r) => [r.description, r.amount, r.isSplitPart])).toEqual([["קניון עזריאלי", -20000n, true]]);
    expect(list.totalMinor).toBe(-20000n);
    const [top] = await q((tx) => merchantBreakdown(tx, asMember(partner), "2026-10"));
    expect(top).toMatchObject({ name: expect.stringContaining("עזריאלי"), minor: 20000n, count: 1 });
    const [largest] = await q((tx) => largestTransactions(tx, asMember(partner), "2026-10"));
    expect(largest!.amount).toBe(-20000n);
    const [b] = await q((tx) => budgetsWithStatus(tx, asMember(partner), "2026-10"));
    expect(b!.status.spentMinor).toBe(20000n);
  });
});
