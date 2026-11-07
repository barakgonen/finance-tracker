// Recurring payments, insights and merchant management over data from the real import pipeline,
// queried as the restricted app role.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { merchant, scoped, transaction, type Db } from "@ft/db";
import { addAccount, commitImport, correctTransaction, createHousehold, mergeMerchants, renameMerchant, setMerchantCategory, stageStatement } from "@ft/ingest";
import type { ParsedStatement } from "@ft/parsers";
import { bankStatement, cardStatement, fileFor, row, startHarness, type Harness } from "../../ingest/test/harness.js";
import { merchantDetail, monthInsights, recurringSeries, upcoming, type Filters } from "../src/index.js";

let h: Harness;
const HH = randomUUID();
let cardId: string;
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
  cardId = ids.card;
  const months = ["07", "08", "09", "10"];
  for (const [i, m] of months.entries()) {
    const last = m === "10";
    await load(
      cardStatement("cal", "1111", `2026-${m}-28`, [
        row(`2026-${m}-03`, "Spotify P46B9945EB", -2390),
        row(`2026-${m}-04`, "NETFLIX.COM", last ? -5490 : -4990),
        row(`2026-${m}-12`, "מסעדה א", last ? -90000 : -50000),
        ...(last
          ? [row("2026-10-15", "KSP נשר", -24900), row("2026-10-15", "KSP נשר", -24900), row("2026-10-20", "אייס", -49668, { installment: { no: 2, total: 3 } })]
          : []),
        ...(i === 0 ? [row("2026-07-20", "אבוטבול ברברי", -8000), row("2026-07-21", "אבוטבול מספרה", -9000)] : []),
      ]),
      ids.card,
    );
  }
  await load(bankStatement(months.map((m) => row(`2026-${m}-01`, "משכורת", 1500000))), ids.bank);
});
afterAll(() => h?.stop());

describe("recurring payments", () => {
  it("finds subscriptions, the installment plan and the salary; a varying restaurant bill is not recurring", async () => {
    const series = await q((tx) => recurringSeries(tx, F, "2026-10"));
    const by = Object.fromEntries(series.map((s) => [s.label, s]));
    expect(by["Spotify P46B9945EB"]).toMatchObject({ cadence: "monthly", monthlyMinor: 2390n, categorySlug: "subscriptions", active: true });
    expect(by["NETFLIX.COM"]).toMatchObject({ lastAmountMinor: 5490n, previousTypicalMinor: 4990n });
    expect(by["אייס"]?.installments).toEqual({ paid: 2, total: 3, remaining: 1 });
    expect(by["משכורת"]).toMatchObject({ direction: "in", cadence: "monthly" });
    expect(by["מסעדה א"]).toBeUndefined();
  });

  it("lists what is expected in the coming month", async () => {
    const series = await q((tx) => recurringSeries(tx, F, "2026-10"));
    const next = upcoming(series, "2026-10-25", 30).map((s) => s.label);
    expect(next).toEqual(expect.arrayContaining(["משכורת", "Spotify P46B9945EB", "NETFLIX.COM", "אייס"]));
  });
});

describe("insights", () => {
  it("explains October: restaurant spike, subscriptions, Netflix price rise and a possible duplicate", async () => {
    const insights = await q((tx) => monthInsights(tx, F, "2026-10"));
    const by = Object.fromEntries(insights.map((i) => [i.detector, i]));
    expect(by.category_spike).toMatchObject({ categorySlug: "dining", monthlyImpactMinor: 40000n, params: { percent: 80 } });
    expect(by.subscriptions).toMatchObject({ params: { count: 2 }, monthlyImpactMinor: 7380n });
    expect(by.price_increase).toMatchObject({ params: { before: 4990, now: 5490 } });
    expect(by.duplicate_charge).toMatchObject({ oneOffMinor: 24900n });
    expect(by.duplicate_charge!.evidence).toHaveLength(2);
  });

  it("stays quiet in the first month, when there is nothing to compare with", async () => {
    const insights = await q((tx) => monthInsights(tx, F, "2026-07"));
    expect(insights.filter((i) => i.detector === "category_spike" || i.detector === "savings_drop")).toEqual([]);
  });
});

describe("merchants", () => {
  const merchantId = (name: string) => q(async (tx) => (await tx.select().from(merchant).where(and(eq(merchant.householdId, HH), eq(merchant.name, name))))[0]!.id);

  it("summarizes a merchant's last twelve months", async () => {
    const d = await q(async (tx) => merchantDetail(tx, F, await merchantId("NETFLIX.COM"), "2026-10"));
    expect(d).toMatchObject({ totalMinor: 20460n, count: 4, commonAmounts: [{ amountMinor: 4990n, count: 3 }] });
    expect(d!.months).toHaveLength(12);
  });

  it("merges merchants: transactions and future imports go to the target", async () => {
    const [a, b] = [await merchantId("אבוטבול ברברי"), await merchantId("אבוטבול מספרה")];
    await q((tx) => mergeMerchants(tx, HH, b, a));
    const at = await q((tx) => tx.select().from(transaction).where(eq(transaction.merchantId, a)));
    expect(at).toHaveLength(2);
    await load(cardStatement("cal", "1111", "2026-11-28", [row("2026-11-05", "אבוטבול מספרה", -9500)]), cardId);
    const after = await q((tx) => tx.select().from(transaction).where(eq(transaction.merchantId, a)));
    expect(after).toHaveLength(3);
    await expect(q((tx) => mergeMerchants(tx, HH, a, a))).rejects.toThrow(/itself/);
  });

  it("categorizes all of a merchant's transactions, keeping manual edits", async () => {
    const id = await merchantId("אבוטבול ברברי");
    const txs = await q((tx) => tx.select().from(transaction).where(eq(transaction.merchantId, id)));
    await q((tx) => correctTransaction(tx, { householdId: HH, transactionId: txs[0]!.id, category: "gifts" }));
    const changed = await q((tx) => setMerchantCategory(tx, HH, id, "personal_care"));
    expect(changed).toBe(2);
    const cats = await q(async (tx) =>
      (await tx.select({ id: transaction.id, manual: transaction.isManuallyEdited, source: transaction.classificationSource }).from(transaction).where(eq(transaction.merchantId, id))),
    );
    expect(cats.filter((c) => c.manual)).toHaveLength(1);
    expect(cats.filter((c) => !c.manual).every((c) => c.source === "merchant")).toBe(true);
    await q((tx) => renameMerchant(tx, HH, id, "אבוטבול"));
    expect((await q((tx) => tx.select().from(merchant).where(eq(merchant.id, id))))[0]!.name).toBe("אבוטבול");
  });
});

describe("handled insights", () => {
  it("hide once marked handled or not relevant, and come back when reopened", async () => {
    const { openInsights } = await import("../src/index.js");
    const { setInsightState } = await import("@ft/ingest");
    const before = await q((tx) => openInsights(tx, F, "2026-10"));
    const dup = before.open.find((i) => i.detector === "duplicate_charge")!;
    await q((tx) => setInsightState(tx, HH, dup.id, "dismissed"));
    const after = await q((tx) => openInsights(tx, F, "2026-10"));
    expect(after.open.map((i) => i.id)).not.toContain(dup.id);
    expect(after.handled).toEqual([{ insight: expect.objectContaining({ id: dup.id }), status: "dismissed" }]);
    await q((tx) => setInsightState(tx, HH, dup.id, null));
    expect((await q((tx) => openInsights(tx, F, "2026-10"))).open.map((i) => i.id)).toContain(dup.id);
    await expect(q((tx) => setInsightState(tx, HH, "x'; drop table", "done"))).rejects.toThrow(/Invalid insight/);
    // price-increase ids carry the recurring series key, "|" included
    const price = before.open.find((i) => i.detector === "price_increase")!;
    expect(price.id).toContain("|");
    await q((tx) => setInsightState(tx, HH, price.id, "done"));
    expect((await q((tx) => openInsights(tx, F, "2026-10"))).handled.map((x) => x.status)).toEqual(["done"]);
  });
});
