// A bank debit leads to the statement bills it paid, and a statement to the debit that paid it.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { importFile, scoped, transaction, type Db } from "@ft/db";
import { addAccount, commitImport, createHousehold, stageStatement } from "@ft/ingest";
import type { ParsedStatement } from "@ft/parsers";
import { bankStatement, cardStatement, fileFor, row, startHarness, type Harness } from "../../ingest/test/harness.js";
import { billsForDebits, billsOfImport, billSummary, listTransactions, monthTotals } from "../src/index.js";

let h: Harness;
const HH = randomUUID();
const q = <T>(fn: (tx: Db) => Promise<T>) => scoped(h.appDb, { householdId: HH }, fn);
let ids: { me: string; partner: string; bank: string; mine: string; hers: string };

beforeAll(async () => {
  h = await startHarness();
  ids = await q(async (tx) => {
    const { members } = await createHousehold(tx, "t", [{ displayName: "me", role: "admin" }, { displayName: "partner" }], HH);
    const bank = await addAccount(tx, HH, { type: "bank", institution: "leumi", name: "joint" });
    const mine = await addAccount(tx, HH, { type: "credit_card", institution: "cal", name: "mine", numberLast4: "1111", ownerMemberId: members[0]!.id });
    const hers = await addAccount(tx, HH, { type: "credit_card", institution: "max", name: "hers", numberLast4: "2222", ownerMemberId: members[1]!.id, visibility: "private" });
    return { me: members[0]!.id, partner: members[1]!.id, bank: bank.id, mine: mine.id, hers: hers.id };
  });
  const load = (s: ParsedStatement, accountId: string) =>
    q(async (tx) => {
      const deps = { db: tx, blobs: h.deps.blobs };
      const p = await stageStatement(deps, { householdId: HH, file: fileFor(s), statement: s, accountId });
      await commitImport(deps, { householdId: HH, importId: p.importId });
    });
  // September purchases on the bill charged in October
  await load(cardStatement("cal", "1111", "2026-10-02", [row("2026-09-03", "שופרסל", -30000), row("2026-09-20", "WOLT", -4500)]), ids.mine);
  await load(cardStatement("max", "2222", "2026-10-15", [row("2026-09-05", "בוטיק סודי", -50000)]), ids.hers);
  await load(bankStatement([row("2026-10-02", "כרטיסי אשראי-י", -34500), row("2026-10-15", "מקס איט פיננ-י", -50000)]), ids.bank);
});
afterAll(() => h?.stop());

const asMe = () => ({ householdId: HH, viewerMemberId: ids.me });
const debitOf = (description: string) =>
  q(async (tx) => (await tx.select().from(transaction).where(and(eq(transaction.accountId, ids.bank), eq(transaction.descriptionRaw, description))))[0]!);

describe("card bills and bank debits", () => {
  it("a bank debit shows the bill it paid and leads to that bill's rows, whatever their month", async () => {
    const debit = await debitOf("כרטיסי אשראי-י");
    const [bill, ...rest] = (await q((tx) => billsForDebits(tx, asMe(), [debit.id]))).get(debit.id)!;
    expect(rest).toEqual([]);
    expect(bill).toMatchObject({ cardName: "mine", cardLast4: "1111", postingDate: "2026-10-02", totalMinor: 34500n, rowCount: 2 });
    const rows = await q((tx) => listTransactions(tx, asMe(), { from: "2026-10-01", to: "2026-11-01", billId: bill!.billId }));
    expect(rows.rows.map((r) => r.description).sort()).toEqual(["WOLT", "שופרסל"]);
    expect(rows.totalMinor).toBe(debit.amount);
  });

  it("the money is counted once: as the card rows, not the debit", async () => {
    const t = await q((tx) => monthTotals(tx, asMe(), "2026-10"));
    expect(t.expensesMinor).toBe(0n);
    const sep = await q((tx) => monthTotals(tx, asMe(), "2026-09"));
    expect(sep.expensesMinor).toBe(84500n);
  });

  it("another member's private card shows as paid, without its name or rows", async () => {
    const debit = await debitOf("מקס איט פיננ-י");
    const [bill] = (await q((tx) => billsForDebits(tx, asMe(), [debit.id]))).get(debit.id)!;
    expect(bill).toMatchObject({ cardName: null, cardLast4: null, rowCount: 0, totalMinor: 50000n });
    expect(await q((tx) => billSummary(tx, asMe(), bill!.billId))).toBeNull();
    expect(await q((tx) => billSummary(tx, { householdId: HH, viewerMemberId: ids.partner }, bill!.billId))).toMatchObject({ cardName: "hers" });
  });

  it("a statement shows which bank debit paid each of its bills", async () => {
    const imp = await q(async (tx) => (await tx.select().from(importFile).where(and(eq(importFile.householdId, HH), eq(importFile.accountId, ids.mine))))[0]!);
    const [bill] = await q((tx) => billsOfImport(tx, asMe(), imp.id));
    expect(bill!.debit).toMatchObject({ date: "2026-10-02", amountMinor: -34500n, accountName: "joint", billsPaid: 1 });
  });
});
