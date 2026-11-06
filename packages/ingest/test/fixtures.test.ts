// End-to-end over the real statements in <repo>/fixtures (gitignored). Skipped when absent.
// Assertions are data-driven so no personal figures live in this file.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { account, cardBill, cardSettlement, category, transaction } from "@ft/db";
import { parseFile } from "@ft/parsers";
import { addAccount, commitImport, createHousehold, stageImport } from "../src/index.js";
import { startHarness, type Harness } from "./harness.js";

const DIR = resolve(__dirname, "../../../fixtures");
// bank first: the harder order for settlement matching
const files = existsSync(DIR)
  ? ["leumi", "cal", "isracard", "max"]
      .filter((d) => existsSync(join(DIR, d)))
      .flatMap((d) => readdirSync(join(DIR, d)).map((f) => join(DIR, d, f)))
  : [];
const input = (path: string) => ({ fileName: basename(path), bytes: new Uint8Array(readFileSync(path)) });
const PARTNER_BILL = 'ישראכרט בע"מ';

describe.skipIf(files.length === 0)("importing the real statements", () => {
  let h: Harness;
  let hid: string;
  let partnerId: string;
  let bankId: string;

  const all = () => h.deps.db.select().from(transaction).where(eq(transaction.householdId, hid));
  const bankRows = () =>
    h.deps.db
      .select({ t: transaction })
      .from(transaction)
      .innerJoin(account, eq(account.id, transaction.accountId))
      .where(and(eq(transaction.householdId, hid), eq(account.type, "bank")))
      .then((rows) => rows.map((r) => r.t));

  beforeAll(async () => {
    h = await startHarness();
    const { household, members } = await createHousehold(h.deps.db, "real", [{ displayName: "me", role: "admin" }, { displayName: "partner" }]);
    hid = household.id;
    const [me, partner] = members as [(typeof members)[0], (typeof members)[0]];
    partnerId = partner.id;
    bankId = (await addAccount(h.deps.db, hid, { type: "bank", institution: "leumi", name: "Leumi" })).id;

    // one tracked account per card the statements name, owned by me
    const cards = new Map<string, { institution: string; cardLast4?: string }>();
    for (const f of files) {
      const { statement } = await parseFile(input(f));
      if (statement.account.type === "credit_card") cards.set(`${statement.account.institution}/${statement.account.cardLast4}`, statement.account);
    }
    for (const c of cards.values()) {
      await addAccount(h.deps.db, hid, {
        type: "credit_card",
        institution: c.institution,
        name: `my ${c.institution}`,
        numberLast4: c.cardLast4,
        ownerMemberId: me.id,
        settlesToAccountId: bankId,
      });
    }
    // the partner's card: statements never imported, its bills recognized by their description
    await addAccount(h.deps.db, hid, {
      type: "credit_card",
      institution: "isracard",
      name: "partner isracard",
      ownerMemberId: partner.id,
      tracksStatements: false,
      billDescriptionPattern: PARTNER_BILL,
    });
  });
  afterAll(() => h?.stop());

  it("stores every row of every distinct statement exactly once", async () => {
    // Expected count, computed without fingerprints: copies of one statement (PDF + spreadsheet,
    // or the same export downloaded twice) share their printed bills, or for bank exports their
    // exact rows, and count once. Every distinct statement's rows must all be stored.
    const statements = new Map<string, number>();
    let inserted = 0;
    for (const f of files) {
      const preview = await stageImport(h.deps, { householdId: hid, file: input(f) });
      expect(preview.error, f).toBeNull();
      expect(preview.accountId, f).not.toBeNull();
      expect(preview.reconciliation?.ok, f).toBe(true);
      inserted += (await commitImport(h.deps, { householdId: hid, importId: preview.importId })).inserted;

      const { statement } = await parseFile(input(f));
      const identity =
        statement.totals.length > 0
          ? statement.totals.map((t) => `${t.postingDate} ${t.amount.minor}`).sort().join(",")
          : statement.transactions.map((t) => `${t.purchaseDate} ${t.amount.minor} ${t.balance?.minor}`).sort().join(",");
      statements.set(`${preview.accountId} ${identity}`, statement.transactions.length);
    }
    const expected = [...statements.values()].reduce((a, b) => a + b, 0);
    const rows = await all();
    expect(rows.length).toBe(inserted);
    expect(rows.length).toBe(expected);
  });

  it("rejects re-uploading any of the files", async () => {
    for (const f of files) {
      await expect(stageImport(h.deps, { householdId: hid, file: input(f) })).rejects.toMatchObject({ code: "duplicate_file" });
    }
  });

  it("links every bill charged inside the bank export's dates to its debit, and excludes nothing unlinked", async () => {
    const bank = await bankRows();
    const dates = bank.map((t) => t.purchaseDate).sort();
    const bills = await h.deps.db.select().from(cardBill).where(eq(cardBill.householdId, hid));
    const inRange = bills.filter((b) => b.postingDate >= dates[0]! && b.postingDate <= dates.at(-1)!);
    expect(inRange.length).toBeGreaterThan(0);

    const settlements = await h.deps.db.select().from(cardSettlement).where(eq(cardSettlement.householdId, hid));
    const settledBills = new Set(settlements.map((s) => s.cardBillId));
    expect(inRange.filter((b) => !settledBills.has(b.id)).map((b) => b.label)).toEqual([]);

    const settledDebits = new Set(settlements.map((s) => s.bankTransactionId));
    expect(bank.filter((t) => t.kind === "card_settlement" && !settledDebits.has(t.id)).map((t) => t.descriptionRaw)).toEqual([]);
  });

  it("counts the partner's untracked card bills as the partner's unitemized spending, without review", async () => {
    const [unitemized] = await h.deps.db.select().from(category).where(and(eq(category.householdId, hid), eq(category.slug, "card_unitemized")));
    const partnerBills = (await bankRows()).filter((t) => t.descriptionRaw.startsWith(PARTNER_BILL) && t.amount < 0n);
    expect(partnerBills.length).toBeGreaterThan(0);
    for (const t of partnerBills) {
      expect(t).toMatchObject({ kind: "expense", categoryId: unitemized!.id, memberId: partnerId, needsReview: false });
    }
  });
});
