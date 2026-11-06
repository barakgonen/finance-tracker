// Runs against real statements in <repo>/fixtures (gitignored: they contain personal data).
// Skipped when the folder is absent. Snapshots are written next to the fixtures, never into git.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classify,
  fingerprintBatch,
  matchSettlements,
  normalizeDescription,
  ruleFromCorrection,
  SYSTEM_CATEGORIES,
  type ClassifierContext,
} from "@ft/core";
import { parseFile, type ParseResult } from "./index.js";

const DIR = resolve(__dirname, "../../../fixtures");
const files = existsSync(DIR)
  ? readdirSync(DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("__"))
      .flatMap((d) => readdirSync(join(DIR, d.name)).map((f) => join(DIR, d.name, f)))
  : [];

const cache = new Map<string, Promise<ParseResult>>();
const parse = (path: string) => {
  if (!cache.has(path)) cache.set(path, parseFile({ fileName: basename(path), bytes: new Uint8Array(readFileSync(path)) }));
  return cache.get(path)!;
};
const find = (re: RegExp) => files.find((f) => re.test(f));
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

describe.skipIf(files.length === 0)("real statements", () => {
  it.each(files.map((f) => [f.slice(DIR.length + 1), f]))("%s parses and reconciles", async (_, path) => {
    const { statement, reconciliation } = await parse(path);
    expect(statement.transactions.length).toBeGreaterThan(0);
    expect(reconciliation.problems).toEqual([]);
    await expect(json(statement)).toMatchFileSnapshot(join(DIR, "__snapshots__", `${basename(path)}.json`));
  });

  // The same statement exported as PDF and as a spreadsheet must produce the same ledger rows.
  const pairs: [string, RegExp, RegExp][] = [
    ["cal oct", /cal-oct\.pdf$/, /cal-oct\.xlsx$/],
    ["cal nov", /cal-nov\.pdf$/, /cal-nov\.xlsx$/],
    ["cal dec", /cal-dec\.pdf$/, /cal-dec\.xlsx$/],
    ["leumi", /leumi\/download\.pdf$/, /leumi\/.*\.xls$/],
  ];
  it.each(pairs)("%s: PDF and spreadsheet agree", async (_, a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (!pa || !pb) return;
    const key = (r: ParseResult) =>
      r.statement.transactions
        .map((t) => `${t.purchaseDate} ${t.amount.minor} ${normalizeDescription(t.description).key}`)
        .sort();
    expect(key(await parse(pa))).toEqual(key(await parse(pb)));
  });

  it("re-importing the same data from a different file yields identical fingerprints", async () => {
    const maxFiles = files.filter((f) => /max\/.*\.xlsx$/.test(f));
    const prints = await Promise.all(
      maxFiles.map(async (f) => {
        const { statement } = await parse(f);
        return fingerprintBatch(
          statement.transactions.map((t) => ({
            accountId: "max",
            purchaseDate: t.purchaseDate,
            amountMinor: t.amount.minor,
            currency: t.amount.currency,
            descriptionRaw: t.description,
          })),
        ).join(",");
      }),
    );
    // two of the Max exports contain the same September statement
    expect(new Set(prints).size).toBeLessThan(prints.length);
  });

  it("card bills match the Leumi debits that paid them", async () => {
    const bank = find(/leumi\/.*\.xls$/);
    if (!bank) return;
    const debits = (await parse(bank)).statement.transactions.map((t) => ({
      id: `${t.purchaseDate} ${t.description} ${t.amount.minor}`,
      date: t.purchaseDate,
      amountMinor: t.amount.minor,
      description: t.description,
    }));
    const dates = debits.map((d) => d.date).sort();
    // one bill per (issuer, posting date, total): a PDF and a spreadsheet of the same bill are one bill
    const bills = new Map<string, { id: string; institution: string; postingDate: string; totalMinor: bigint }>();
    for (const f of files.filter((f) => /(cal|isracard|max)\//.test(f) && /\.(pdf|xlsx)$/.test(f))) {
      const { statement } = await parse(f);
      for (const t of statement.totals) {
        const id = `${statement.account.institution} ${t.postingDate} ${t.amount.minor}`;
        bills.set(id, { id, institution: statement.account.institution, postingDate: t.postingDate ?? "", totalMinor: t.amount.minor });
      }
    }
    // only bills charged inside the bank export's date range can have a matching debit
    const inRange = [...bills.values()].filter((b) => b.postingDate >= dates[0]! && b.postingDate <= dates[dates.length - 1]!);
    expect(inRange.length).toBeGreaterThan(0);
    const matches = matchSettlements(inRange, debits);
    expect(matches.map((m) => m.billId).sort()).toEqual(inRange.map((b) => b.id).sort());
    expect(matches.every((m) => m.issuerMatched)).toBe(true);
  });
});

describe.skipIf(files.length === 0)("classification on real statements", () => {
  const expenseCategories = new Set(SYSTEM_CATEGORIES.filter((c) => c.type === "expense").map((c) => c.slug));
  const classifyFile = async (path: string, ctx: ClassifierContext = {}) => {
    const { statement } = await parse(path);
    return statement.transactions.map((t) => ({
      t,
      c: classify(
        { description: t.description, amountMinor: t.amount.minor, accountType: statement.account.type, categoryHint: t.categoryHint, typeHint: t.typeHint },
        ctx,
      ),
    }));
  };
  const cardFiles = files.filter((f) => /(cal|isracard|max)\//.test(f) && /\.(pdf|xlsx)$/.test(f));

  it("classifies at least 85% of card transactions without review, before any corrections", async () => {
    const results = (await Promise.all(cardFiles.map((f) => classifyFile(f)))).flat();
    const auto = results.filter((r) => !r.c.needsReview).length;
    expect(auto / results.length).toBeGreaterThanOrEqual(0.85);
  });

  it("never produces contradictory kind/category pairs", async () => {
    for (const f of files.filter((f) => !f.includes("__"))) {
      for (const { t, c } of await classifyFile(f)) {
        const ctx = `${basename(f)}: ${t.description}`;
        if (c.kind === "income") expect(c.category === null || !expenseCategories.has(c.category), ctx).toBe(true);
        if (c.kind === "expense" || c.kind === "fee") expect(t.amount.minor < 0n, ctx).toBe(true);
        if (c.kind === "card_settlement") expect(t.amount.minor < 0n, ctx).toBe(true);
      }
    }
  });

  it("corrections made on one month reduce review on the following months", async () => {
    const months = ["aug", "sep", "oct"].map((m) => find(new RegExp(`isracard/${m}\\.pdf$`)));
    if (months.some((m) => !m)) return;
    const [aug, ...later] = months as string[];
    // the user resolves every August review item once; each correction becomes a merchant rule
    const rules = (await classifyFile(aug!))
      .filter((r) => r.c.needsReview)
      .map((r, i) => ruleFromCorrection(`r${i}`, r.t.description, { category: "other_expense" }));
    const pending = async (ctx: ClassifierContext) =>
      (await Promise.all(later.map((f) => classifyFile(f, ctx)))).flat().filter((r) => r.c.needsReview).length;
    const before = await pending({});
    const after = await pending({ rules });
    expect(after).toBeLessThan(before);
  });

  it("card-bill debits stay in review until the settlement matcher confirms them", async () => {
    const bank = find(/leumi\/.*\.xls$/);
    if (!bank) return;
    const rows = await classifyFile(bank);
    const flagged = rows.filter((r) => r.c.kind === "card_settlement");
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((r) => r.c.needsReview)).toBe(true);
  });
});
