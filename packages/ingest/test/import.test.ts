import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, cardSettlement, category, merchant, rawRow, transaction, type Db } from "@ft/db";
import {
  addAccount,
  commitImport,
  correctTransaction,
  createHousehold,
  ImportError,
  reclassify,
  stageStatement,
  type IngestDeps,
} from "../src/index.js";
import type { ParsedStatement } from "@ft/parsers";
import { bankStatement, cardStatement, fileFor, row, startHarness, type Harness } from "./harness.js";

let h: Harness;
let deps: IngestDeps;
beforeAll(async () => {
  h = await startHarness();
  deps = h.deps;
});
afterAll(() => h?.stop());

/** A fresh household per test: me + partner, a shared bank account, and cards. */
let hh: Awaited<ReturnType<typeof setupHousehold>>;
async function setupHousehold() {
  const { household, members } = await createHousehold(deps.db, "test", [{ displayName: "me", role: "admin" }, { displayName: "partner" }]);
  const [me, partner] = members as [(typeof members)[0], (typeof members)[0]];
  const bank = await addAccount(deps.db, household.id, { type: "bank", institution: "leumi", name: "Leumi joint" });
  const cal = await addAccount(deps.db, household.id, { type: "credit_card", institution: "cal", name: "my Cal", numberLast4: "1111", ownerMemberId: me.id, settlesToAccountId: bank.id });
  const myIsracard = await addAccount(deps.db, household.id, { type: "credit_card", institution: "isracard", name: "my Isracard", numberLast4: "2222", ownerMemberId: me.id });
  const partnerIsracard = await addAccount(deps.db, household.id, {
    type: "credit_card",
    institution: "isracard",
    name: "partner Isracard",
    ownerMemberId: partner.id,
    tracksStatements: false,
    billDescriptionPattern: 'ישראכרט בע"מ',
  });
  return { hid: household.id, me, partner, bank, cal, myIsracard, partnerIsracard };
}
beforeEach(async () => {
  hh = await setupHousehold();
});

const stageAndCommit = async (statement: ParsedStatement, accountId?: string) => {
  const preview = await stageStatement(deps, { householdId: hh.hid, file: fileFor(statement), statement, accountId });
  const result = await commitImport(deps, { householdId: hh.hid, importId: preview.importId, actorMemberId: hh.me.id });
  return { preview, result };
};
const txs = (db: Db, accountId: string) => db.select().from(transaction).where(eq(transaction.accountId, accountId));
const slugOf = async (categoryId: string | null) =>
  categoryId ? (await deps.db.select({ slug: category.slug }).from(category).where(eq(category.id, categoryId)))[0]!.slug : null;

describe("stage -> preview -> commit", () => {
  it("imports a card statement into the right account with ownership, categories, merchants and raw rows", async () => {
    const statement = cardStatement("cal", "1111", "2026-10-02", [
      row("2026-09-03", "שופרסל דיל 123", -15000),
      row("2026-09-05", "WOLT", -8900),
      row("2026-09-06", "מקום לא מוכר", -2000),
    ]);
    const { preview, result } = await stageAndCommit(statement);
    expect(preview.accountId).toBe(hh.cal.id); // resolved from issuer + last 4
    expect(preview.reconciliation?.ok).toBe(true);
    expect(preview.counts).toMatchObject({ total: 3, new: 3, duplicate: 0, needsReview: 1 });
    expect(result.inserted).toBe(3);

    const rows = await txs(deps.db, hh.cal.id);
    expect(rows.every((r) => r.memberId === hh.me.id && !r.isShared)).toBe(true);
    expect(await slugOf(rows.find((r) => r.descriptionRaw.startsWith("שופרסל"))!.categoryId)).toBe("groceries");
    expect(rows.find((r) => r.descriptionRaw === "מקום לא מוכר")).toMatchObject({ needsReview: true, categoryId: null });
    expect(rows.every((r) => r.rawRowId && r.merchantId)).toBe(true);
    expect((await deps.db.select().from(rawRow).where(eq(rawRow.importFileId, preview.importId))).length).toBe(3);
    expect((await deps.db.select().from(merchant).where(eq(merchant.householdId, hh.hid))).length).toBe(3);
  });

  it("rejects the same file twice, and imports only new rows from an overlapping statement", async () => {
    const first = cardStatement("cal", "1111", "2026-10-02", [row("2026-09-03", "שופרסל", -15000), row("2026-09-03", "שופרסל", -15000)]);
    const file = fileFor(first);
    const p = await stageStatement(deps, { householdId: hh.hid, file, statement: first });
    await commitImport(deps, { householdId: hh.hid, importId: p.importId });
    await expect(stageStatement(deps, { householdId: hh.hid, file, statement: first })).rejects.toMatchObject({ code: "duplicate_file" });

    // a later export covering the same two identical purchases plus a new one
    const overlap = cardStatement("cal", "1111", "2026-10-02", [
      row("2026-09-03", "שופרסל", -15000),
      row("2026-09-03", "שופרסל", -15000),
      row("2026-09-04", "WOLT", -5000),
    ]);
    const { preview, result } = await stageAndCommit(overlap);
    expect(preview.counts).toMatchObject({ new: 1, duplicate: 2 });
    expect(result).toMatchObject({ inserted: 1, duplicates: 2 });
    expect((await txs(deps.db, hh.cal.id)).length).toBe(3);
  });

  it("refuses an unreconciled statement unless overridden, and audits the override", async () => {
    const bad = cardStatement("cal", "1111", "2026-10-02", [row("2026-09-03", "שופרסל", -15000)], 99999);
    const p = await stageStatement(deps, { householdId: hh.hid, file: fileFor(bad), statement: bad });
    expect(p.reconciliation?.ok).toBe(false);
    await expect(commitImport(deps, { householdId: hh.hid, importId: p.importId })).rejects.toMatchObject({ code: "unreconciled" });
    expect((await txs(deps.db, hh.cal.id)).length).toBe(0);

    await commitImport(deps, { householdId: hh.hid, importId: p.importId, overrideReconciliation: { reason: "issuer total includes a fee" } });
    const [audit] = await deps.db.select().from(auditLog).where(and(eq(auditLog.entityId, p.importId), eq(auditLog.action, "commit_with_override")));
    expect(audit?.reason).toBe("issuer total includes a fee");
  });

  it("needs an account when the statement's card is ambiguous or unknown", async () => {
    const s = cardStatement("max", undefined, "2026-10-02", [row("2026-09-03", "שופרסל", -100)]);
    const p = await stageStatement(deps, { householdId: hh.hid, file: fileFor(s), statement: s });
    expect(p.accountId).toBeNull();
    await expect(commitImport(deps, { householdId: hh.hid, importId: p.importId })).rejects.toBeInstanceOf(ImportError);
  });

  it("replaces a pending charge with its posted version", async () => {
    await stageAndCommit(cardStatement("cal", "1111", "2026-10-02", [row("2026-09-10", "ARCAFFE TLV", -1500, { status: "pending" })]));
    const { result } = await stageAndCommit(cardStatement("cal", "1111", "2026-10-02", [row("2026-09-11", "ARCAFFE TLV 5", -1500)]));
    expect(result.supersededPending).toBe(1);
    const rows = await txs(deps.db, hh.cal.id);
    const pending = rows.find((r) => r.status === "pending")!;
    expect(pending.supersededById).toBe(rows.find((r) => r.status === "posted")!.id);
  });
});

describe("card bills vs. bank debits", () => {
  const calBill = () => cardStatement("cal", "1111", "2026-11-02", [row("2026-10-05", "שופרסל", -500000), row("2026-10-07", "WOLT", -43210)]);

  it("links a bill to its debit regardless of import order, and never double-counts", async () => {
    // bank first: the bill debit has no statement yet, so it counts as unitemized spending of my card
    await stageAndCommit(bankStatement([row("2026-11-02", "כרטיסי אשראי-י", -543210), row("2026-11-01", "משכורת", 2000000)]));
    let [debit] = (await txs(deps.db, hh.bank.id)).filter((t) => t.descriptionRaw.startsWith("כרטיסי"));
    expect(debit).toMatchObject({ kind: "expense", memberId: hh.me.id, needsReview: true });
    expect(await slugOf(debit!.categoryId)).toBe("card_unitemized");
    expect(debit!.reviewReason).toMatch(/not imported/);

    // then the card statement arrives: the debit becomes a settlement, the card rows carry the spending
    const { result } = await stageAndCommit(calBill());
    expect(result.settlements.matched).toBe(1);
    [debit] = (await txs(deps.db, hh.bank.id)).filter((t) => t.descriptionRaw.startsWith("כרטיסי"));
    expect(debit).toMatchObject({ kind: "card_settlement", categoryId: null, needsReview: false, classificationSource: "settlement" });
    expect((await deps.db.select().from(cardSettlement).where(eq(cardSettlement.householdId, hh.hid))).length).toBe(1);
  });

  it("card statement first, bank later: matched on the bank import", async () => {
    await stageAndCommit(calBill());
    const { result } = await stageAndCommit(bankStatement([row("2026-11-03", "כרטיסי אשראי-י", -543210)]));
    expect(result.settlements.matched).toBe(1);
  });

  it("an untracked card's bill counts as its owner's unitemized spending, with no review", async () => {
    await stageAndCommit(bankStatement([row("2026-10-11", 'ישראכרט בע"מ-י', -777700)]));
    const [debit] = await txs(deps.db, hh.bank.id);
    expect(debit).toMatchObject({ kind: "expense", memberId: hh.partner.id, isShared: false, needsReview: false });
    expect(await slugOf(debit!.categoryId)).toBe("card_unitemized");

    // if that statement is imported after all, the bill is itemized and the lump flips
    await stageAndCommit(
      cardStatement("isracard", undefined, "2026-10-11", [row("2026-09-20", "ZARA ONLINE", -777700)]),
      hh.partnerIsracard.id,
    );
    const [after] = await txs(deps.db, hh.bank.id);
    expect(after!.kind).toBe("card_settlement");
  });

  it("an issuer debit that could be either partner's card is attributed to the tracked card and flagged", async () => {
    await stageAndCommit(bankStatement([row("2026-10-11", "ישראכרט-כ.וי-י", -222200)]));
    const [debit] = await txs(deps.db, hh.bank.id);
    expect(debit).toMatchObject({ kind: "expense", memberId: hh.me.id, needsReview: true });
  });
});

describe("corrections", () => {
  it("applies a correction to the merchant's other transactions and survives re-classification", async () => {
    await stageAndCommit(
      cardStatement("cal", "1111", "2026-10-02", [row("2026-09-01", "אבוטבול ברברי", -8000), row("2026-09-20", "אבוטבול ברברי", -8000), row("2026-09-21", "שופרסל", -100)]),
    );
    const [first, second] = (await txs(deps.db, hh.cal.id)).filter((t) => t.descriptionRaw === "אבוטבול ברברי");
    expect(first!.needsReview).toBe(true);

    const res = await correctTransaction(deps.db, { householdId: hh.hid, transactionId: first!.id, category: "personal_care", applyToMerchant: true, actorMemberId: hh.me.id });
    expect(res.ruleId).not.toBeNull();
    expect(res.reclassified).toBe(1);
    const updated = (await txs(deps.db, hh.cal.id)).find((t) => t.id === second!.id)!;
    expect(updated).toMatchObject({ classificationSource: "rule", needsReview: false });
    expect(await slugOf(updated.categoryId)).toBe("personal_care");

    // a later manual change on one row is never overwritten by automatic re-classification
    await correctTransaction(deps.db, { householdId: hh.hid, transactionId: second!.id, category: "gifts" });
    await reclassify(deps.db, hh.hid);
    expect(await slugOf((await txs(deps.db, hh.cal.id)).find((t) => t.id === second!.id)!.categoryId)).toBe("gifts");

    // new imports learn from the rule
    const p = await stageStatement(deps, {
      householdId: hh.hid,
      file: fileFor(cardStatement("cal", "1111", "2026-11-02", [row("2026-10-03", "אבוטבול ברברי", -9000)])),
      statement: cardStatement("cal", "1111", "2026-11-02", [row("2026-10-03", "אבוטבול ברברי", -9000)]),
    });
    expect(p.rows[0]!.classification).toMatchObject({ category: "personal_care", source: "rule" });
  });

  it("keeps the issuer's label through re-classification", async () => {
    await stageAndCommit(cardStatement("isracard", "2222", "2026-10-10", [row("2026-09-01", "נדב קינוחים", -3800, { categoryHint: "מעדניות" })]));
    await reclassify(deps.db, hh.hid);
    const [t] = await txs(deps.db, hh.myIsracard.id);
    expect(await slugOf(t!.categoryId)).toBe("groceries");
  });
});

describe("installments", () => {
  it("stores each month's installment of the same purchase", async () => {
    const inst = (no: number) => ({ installment: { no, total: 3 } });
    await stageAndCommit(cardStatement("cal", "1111", "2026-09-02", [row("2026-08-26", "אייס", -33300, inst(1))]));
    const { result } = await stageAndCommit(cardStatement("cal", "1111", "2026-10-02", [row("2026-08-26", "אייס", -33300, inst(2))]));
    expect(result.inserted).toBe(1);
    expect((await txs(deps.db, hh.cal.id)).map((t) => t.installmentNo).sort()).toEqual([1, 2]);
  });
});

describe("account settings", () => {
  it("re-attributes existing bills when a card is marked as untracked", async () => {
    const { updateAccount } = await import("../src/index.js");
    await stageAndCommit(bankStatement([row("2026-10-11", "ישראכרט-כ.וי-י", -222200)]));
    expect((await txs(deps.db, hh.bank.id))[0]).toMatchObject({ memberId: hh.me.id, needsReview: true });

    // the user says this kind of debit is the partner's card
    await updateAccount(deps.db, hh.hid, hh.partnerIsracard.id, { billDescriptionPattern: "ישראכרט-כ" });
    expect((await txs(deps.db, hh.bank.id))[0]).toMatchObject({ memberId: hh.partner.id, needsReview: false });
  });

  it("rejects an invalid bill pattern", async () => {
    const { updateAccount } = await import("../src/index.js");
    await expect(updateAccount(deps.db, hh.hid, hh.partnerIsracard.id, { billDescriptionPattern: "([" })).rejects.toThrow(/not valid/);
  });
});
