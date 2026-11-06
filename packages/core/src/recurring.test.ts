import { describe, expect, it } from "vitest";
import { detectRecurring, type RecurringInput } from "./recurring.js";

let n = 0;
const tx = (key: string, date: string, agorot: number, extra: Partial<RecurringInput> = {}): RecurringInput => ({
  id: `t${n++}`,
  key,
  label: key,
  date,
  amountMinor: BigInt(agorot),
  ...extra,
});
const monthly = (key: string, agorot: number[], startMonth = 5, day = 10) =>
  agorot.map((a, i) => tx(key, `2026-${String(startMonth + i).padStart(2, "0")}-${day}`, a));

describe("detectRecurring", () => {
  it("finds a monthly subscription with its yearly cost and next date", () => {
    const [s] = detectRecurring(monthly("spotify", [-2390, -2390, -2390, -2390]), "2026-08-20");
    expect(s).toMatchObject({ cadence: "monthly", direction: "out", amountMinor: 2390n, monthlyMinor: 2390n, annualMinor: 28680n, nextDate: "2026-09-09", active: true, confidence: "high" });
  });

  it("needs three occurrences: two coincidences are not a pattern", () => {
    expect(detectRecurring(monthly("x", [-5000, -5000]), "2026-07-01")).toEqual([]);
  });

  it("tolerates varying bills, rejects wildly varying amounts", () => {
    expect(detectRecurring(monthly("electric", [-40000, -45000, -38000]), "2026-07-20")).toHaveLength(1);
    expect(detectRecurring(monthly("shop", [-1000, -9000, -3000]), "2026-07-20")).toEqual([]);
  });

  it("rejects irregular timing", () => {
    const items = [tx("cafe", "2026-05-01", -1500), tx("cafe", "2026-05-03", -1500), tx("cafe", "2026-06-20", -1500), tx("cafe", "2026-06-21", -1500)];
    expect(detectRecurring(items, "2026-07-01")).toEqual([]);
  });

  it("allows one skipped month", () => {
    const items = [tx("gym", "2026-03-01", -20000), tx("gym", "2026-04-01", -20000), tx("gym", "2026-06-01", -20000), tx("gym", "2026-07-01", -20000)];
    expect(detectRecurring(items, "2026-07-15")[0]?.cadence).toBe("monthly");
  });

  it("detects bi-monthly bills and normalizes them to a month", () => {
    const items = [tx("water", "2026-01-15", -30000), tx("water", "2026-03-15", -32000), tx("water", "2026-05-15", -31000)];
    const [s] = detectRecurring(items, "2026-06-01");
    expect(s).toMatchObject({ cadence: "bimonthly", amountMinor: 31000n, monthlyMinor: 15500n });
  });

  it("marks a series inactive once it misses a whole period", () => {
    const [s] = detectRecurring(monthly("old", [-1000, -1000, -1000]), "2026-10-01");
    expect(s?.active).toBe(false);
  });

  it("reports the latest amount against the typical one before it (price changes)", () => {
    const [s] = detectRecurring(monthly("netflix", [-4990, -4990, -4990, -5490]), "2026-08-15");
    expect(s).toMatchObject({ lastAmountMinor: 5490n, previousTypicalMinor: 4990n });
  });

  it("detects recurring income separately from payments", () => {
    const [s] = detectRecurring(monthly("employer", [1500000, 1500000, 1520000], 5, 1), "2026-07-15");
    expect(s).toMatchObject({ direction: "in", cadence: "monthly" });
  });

  it("keeps one plan together although per-payment amounts differ by agorot, and reports the latest payment", () => {
    const plan = { installmentTotal: 3, installmentOriginalMinor: 149000n };
    const out = detectRecurring(
      [
        tx("ace", "2026-08-26", -49668, { ...plan, installmentNo: 1 }),
        tx("ace", "2026-08-26", -49666, { ...plan, installmentNo: 2 }),
      ],
      "2026-10-15",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.installments).toEqual({ paid: 2, total: 3, remaining: 1 });
  });

  it("treats an installment plan as recurring with its known remaining payments, from one statement", () => {
    const [s] = detectRecurring([tx("ksp", "2026-08-12", -107500, { installmentNo: 2, installmentTotal: 4 })], "2026-09-01");
    expect(s).toMatchObject({ installments: { paid: 2, total: 4, remaining: 2 }, monthlyMinor: 107500n, annualMinor: 215000n, active: true });
  });
});
