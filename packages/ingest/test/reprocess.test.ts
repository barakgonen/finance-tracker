// Re-processing stored imports after a parser change, as the restricted app role.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, category, importFile, rawRow, scoped, transaction, type Db } from "@ft/db";
import type { ParsedStatement } from "@ft/parsers";
import { addAccount, applyReprocess, commitImport, correctTransaction, createHousehold, outdatedImports, planReprocess, stageStatement, type IngestDeps } from "../src/index.js";
import { cardStatement, fileFor, row, startHarness, type Harness } from "./harness.js";

let h: Harness;
const HH = randomUUID();
let card: string;
const q = <T>(fn: (tx: Db) => Promise<T>) => scoped(h.appDb, { householdId: HH }, fn);
const deps = (db: Db): IngestDeps => ({ db: db as IngestDeps["db"], blobs: h.deps.blobs });

beforeAll(async () => {
  h = await startHarness();
  card = await q(async (tx) => {
    await createHousehold(tx, "t", [{ displayName: "me", role: "admin" }], HH);
    return (await addAccount(tx, HH, { type: "credit_card", institution: "cal", name: "card", numberLast4: "1111" })).id;
  });
});
afterAll(() => h?.stop());

/** Version 1 of a parser: misses one purchase, invents one, and misreads an installment. */
const v1 = (): ParsedStatement => ({
  ...cardStatement("cal", "1111", "2026-10-02", [row("2026-09-03", "שופרסל", -15000), row("2026-09-05", "אייס", -49668), row("2026-09-30", "סה\"כ חודשי", -1000), row("2026-09-08", "נדב קינוחים", -3800)]),
  adapter: "fake-cal",
  adapterVersion: 1,
});
/** Version 2: reads the installment, drops the invented row, finds the missed purchase. */
const v2 = (): ParsedStatement => ({
  ...cardStatement("cal", "1111", "2026-10-02", [
    row("2026-09-03", "שופרסל", -15000),
    row("2026-09-05", "אייס", -49668, { installment: { no: 1, total: 3 } }),
    row("2026-09-08", "נדב קינוחים", -3800, { categoryHint: "מעדניות" }),
    row("2026-09-20", "WOLT", -8900),
  ]),
  adapter: "fake-cal",
  adapterVersion: 2,
});
const parseAs = (s: () => ParsedStatement) => async () => ({ statement: s() });

async function importV1(): Promise<string> {
  return q(async (tx) => {
    const s = v1();
    const p = await stageStatement(deps(tx), { householdId: HH, file: fileFor(s, randomUUID()), statement: s, accountId: card });
    await commitImport(deps(tx), { householdId: HH, importId: p.importId });
    return p.importId;
  });
}
const rows = () => q((tx) => tx.select().from(transaction).where(eq(transaction.accountId, card)));

describe("reprocessing", () => {
  it("finds outdated imports and previews exactly what a new parser version would change", async () => {
    const importId = await importV1();
    expect((await q((tx) => outdatedImports(tx, HH, () => 2))).map((x) => x.id)).toContain(importId);
    expect(await q((tx) => outdatedImports(tx, HH, () => 1))).toEqual([]);

    const p = await q((tx) => planReprocess(deps(tx), HH, importId, parseAs(v2)));
    expect(p).toMatchObject({ committed: true, fromVersion: 1, toVersion: 2, unchanged: 1, elsewhere: 0 });
    expect(p.added.map((a) => a.description)).toEqual(["WOLT"]);
    expect(p.removed.map((r) => [r.description, r.keep])).toEqual([['סה"כ חודשי', null]]);
    expect(p.updated.map((u) => [u.description, u.changes])).toEqual([
      ["אייס", ["installmentNo", "installmentTotal"]],
      ["נדב קינוחים", ["categoryHint"]],
    ]);
    // the preview changed nothing
    expect((await rows()).length).toBe(4);

    // apply: keep the manual category, fix the installment, add the missed row, drop the invented one
    const supermarket = (await rows()).find((t) => t.descriptionRaw === "שופרסל")!;
    await q((tx) => correctTransaction(tx, { householdId: HH, transactionId: supermarket.id, category: "gifts" }));
    await q((tx) => applyReprocess(deps(tx), { householdId: HH, importId, removeMissing: true }, parseAs(v2)));
    const after = await rows();
    expect(after.map((t) => t.descriptionRaw).sort()).toEqual(["WOLT", "אייס", "נדב קינוחים", "שופרסל"].sort());
    expect(after.find((t) => t.descriptionRaw === "אייס")).toMatchObject({ installmentNo: 1, installmentTotal: 3 });
    const gifts = (await q((tx) => tx.select().from(category).where(and(eq(category.householdId, HH), eq(category.slug, "gifts")))))[0]!;
    expect(after.find((t) => t.id === supermarket.id)).toMatchObject({ categoryId: gifts.id, isManuallyEdited: true });
    // the corrected issuer label now categorizes the dessert shop
    const groceries = (await q((tx) => tx.select().from(category).where(and(eq(category.householdId, HH), eq(category.slug, "groceries")))))[0]!;
    expect(after.find((t) => t.descriptionRaw === "נדב קינוחים")!.categoryId).toBe(groceries.id);

    const [imp] = await q((tx) => tx.select().from(importFile).where(eq(importFile.id, importId)));
    expect(imp!.parserVersion).toBe(2);
    const versions = await q((tx) => tx.select({ v: rawRow.parserVersion }).from(rawRow).where(eq(rawRow.importFileId, importId)));
    expect([...new Set(versions.map((x) => x.v))].sort()).toEqual([1, 2]); // the v1 extraction is kept
    expect((await q((tx) => tx.select().from(auditLog).where(and(eq(auditLog.entityId, importId), eq(auditLog.action, "reprocess"))))).length).toBe(1);
    // running it again changes nothing
    const again = await q((tx) => planReprocess(deps(tx), HH, importId, parseAs(v2)));
    expect(again).toMatchObject({ added: [], updated: [], removed: [], unchanged: 4 });
  });

  it("never deletes a row the user edited, even when asked to remove missing rows", async () => {
    // a separate account, so this import really creates its own rows
    const other = await q((tx) => addAccount(tx, HH, { type: "credit_card", institution: "cal", name: "card 2", numberLast4: "2222" }));
    const importId = await q(async (tx) => {
      const s = v1();
      const p = await stageStatement(deps(tx), { householdId: HH, file: fileFor(s, randomUUID()), statement: s, accountId: other.id });
      await commitImport(deps(tx), { householdId: HH, importId: p.importId });
      return p.importId;
    });
    const mine = () => q((tx) => tx.select().from(transaction).where(eq(transaction.accountId, other.id)));
    const invented = (await mine()).find((t) => t.descriptionRaw === 'סה"כ חודשי')!;
    await q((tx) => correctTransaction(tx, { householdId: HH, transactionId: invented.id, category: "other_expense" }));

    const p = await q((tx) => planReprocess(deps(tx), HH, importId, parseAs(v2)));
    expect(p.removed).toEqual([expect.objectContaining({ transactionId: invented.id, keep: "edited" })]);
    await q((tx) => applyReprocess(deps(tx), { householdId: HH, importId, removeMissing: true }, parseAs(v2)));
    expect((await mine()).map((t) => t.id)).toContain(invented.id);
    expect((await mine()).length).toBe(5); // the 4 of v2 plus the kept edited row
  });

  it("treats a row that a reprocessed copy already holds as a duplicate, not an update", async () => {
    // the first test reprocessed this account's import; an old-format copy of the same statement
    // now brings back the v1 version of the installment row, which reprocessing must not duplicate
    const importId = await importV1();
    const p = await q((tx) => planReprocess(deps(tx), HH, importId, parseAs(v2)));
    expect(p.removed.filter((r) => r.duplicate).map((r) => r.description)).toEqual(["אייס"]);
    await q((tx) => applyReprocess(deps(tx), { householdId: HH, importId, removeMissing: true }, parseAs(v2)));
    expect((await rows()).filter((t) => t.descriptionRaw === "אייס")).toHaveLength(1);
  });

  it("refuses a re-parse that doesn't reconcile unless overridden", async () => {
    const importId = await importV1();
    const broken = () => ({ ...v2(), totals: v2().totals.map((t) => ({ ...t, amount: { ...t.amount, minor: t.amount.minor + 1n } })) });
    await expect(q((tx) => applyReprocess(deps(tx), { householdId: HH, importId }, parseAs(broken)))).rejects.toMatchObject({ code: "unreconciled" });
    await q((tx) => applyReprocess(deps(tx), { householdId: HH, importId, overrideReconciliation: { reason: "test" } }, parseAs(broken)));
  });

  it("re-stages an import that wasn't committed yet", async () => {
    const importId = await q(async (tx) => {
      const s = v1();
      return (await stageStatement(deps(tx), { householdId: HH, file: fileFor(s, randomUUID()), statement: s, accountId: card })).importId;
    });
    const p = await q((tx) => applyReprocess(deps(tx), { householdId: HH, importId }, parseAs(v2)));
    expect(p.committed).toBe(false);
    const [imp] = await q((tx) => tx.select().from(importFile).where(eq(importFile.id, importId)));
    expect(imp).toMatchObject({ parserVersion: 2, status: "parsed" });
  });
});
