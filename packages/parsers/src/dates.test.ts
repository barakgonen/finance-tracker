import { describe, expect, it } from "vitest";
import { parseIlDate, parseInstallment } from "./dates.js";
import { charge, money } from "./amounts.js";

describe("parseIlDate", () => {
  it.each([
    ["07/08/26", "2026-08-07"],
    ["02.09.2026", "2026-09-02"],
    ["04-08-2026", "2026-08-04"],
  ])("%s", (input, iso) => expect(parseIlDate(input)).toBe(iso));
  it("rejects impossible dates", () => expect(() => parseIlDate("31/02/26")).toThrow());
});

describe("parseInstallment", () => {
  it("reads Hebrew installment notes", () => {
    expect(parseInstallment("תשלום 2 מתוך 8")).toEqual({ no: 2, total: 8 });
    expect(parseInstallment("זיכוי")).toBeUndefined();
  });
});

describe("amounts", () => {
  it("parses spreadsheet numbers and symbol-decorated text", () => {
    expect(money(106.4).minor).toBe(10640n);
    expect(money("₪440.00").minor).toBe(44000n);
    expect(money("440₪").minor).toBe(44000n);
  });
  it("turns printed card charges into negative ledger amounts and refunds into positive", () => {
    expect(charge("1,075.00").minor).toBe(-107500n);
    expect(charge("-28.00").minor).toBe(2800n);
  });
});

import { reconcile } from "./reconcile.js";

describe("reconcile", () => {
  const stmt = (balances: number[], closing?: number) => ({
    adapter: "t",
    adapterVersion: 1,
    account: { type: "bank" as const, institution: "x" },
    totals: [],
    warnings: [],
    transactions: balances.map((b, i) => ({
      rowIndex: i,
      raw: {},
      purchaseDate: "2026-01-01",
      description: "x",
      status: "posted" as const,
      amount: { minor: 100n, currency: "ILS" },
      balance: { minor: BigInt(b), currency: "ILS" },
    })),
    closingBalance: closing === undefined ? undefined : { asOf: "2026-01-01", balance: { minor: BigInt(closing), currency: "ILS" } },
  });

  it("checks a single bank row against the printed closing balance", () => {
    expect(reconcile(stmt([500], 500)).ok).toBe(true);
    expect(reconcile(stmt([500], 600)).ok).toBe(false);
  });
  it("cannot reconcile a single row with nothing printed to check against", () => {
    expect(reconcile(stmt([500])).ok).toBe(false);
  });
  it("detects a broken running balance", () => {
    expect(reconcile(stmt([100, 200, 300])).ok).toBe(true);
    expect(reconcile(stmt([100, 250, 300])).ok).toBe(false);
  });
});
