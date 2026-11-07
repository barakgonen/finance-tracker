import { describe, expect, it } from "vitest";
import { matchSettlements } from "./settlement.js";

describe("matchSettlements", () => {
  const debits = [
    { id: "d1", date: "2026-11-02", amountMinor: -123456n, description: "כרטיסי אשראי-י" },
    { id: "d2", date: "2026-11-02", amountMinor: -5000n, description: "מקס איט פיננ-י" },
    { id: "d3", date: "2026-11-02", amountMinor: -5000n, description: "העברה" },
    { id: "d4", date: "2026-11-20", amountMinor: -777n, description: "ישראכרט-כ.וי-י" },
  ];

  it("matches exact amount within the date window", () => {
    const m = matchSettlements([{ id: "cal", institution: "cal", postingDate: "2026-11-02", totalMinor: 123456n }], debits);
    expect(m).toEqual([{ billId: "cal", debitId: "d1", dayDiff: 0, issuerMatched: true }]);
  });

  it("prefers the debit labelled with the issuer when amounts tie", () => {
    const m = matchSettlements([{ id: "max", institution: "max", postingDate: "2026-11-02", totalMinor: 5000n }], debits);
    expect(m[0]?.debitId).toBe("d2");
  });

  it("never matches outside the window or reuses a debit", () => {
    const bills = [
      { id: "a", institution: "isracard", postingDate: "2026-11-02", totalMinor: 777n },
      { id: "b", institution: "max", postingDate: "2026-11-01", totalMinor: 5000n },
      { id: "c", institution: "max", postingDate: "2026-11-01", totalMinor: 5000n },
    ];
    const m = matchSettlements(bills, debits);
    expect(m.find((x) => x.billId === "a")).toBeUndefined();
    expect(new Set(m.map((x) => x.debitId)).size).toBe(m.length);
    expect(m).toHaveLength(2);
  });
});

import { matchCombinedSettlements, nearMissBill } from "./settlement.js";

describe("matchCombinedSettlements", () => {
  const bill = (id: string, total: bigint, postingDate = "2026-10-10", institution = "isracard") => ({ id, institution, postingDate, totalMinor: total });
  const debit = (id: string, amount: bigint, description = "ישראכרט-כ.וי-י", date = "2026-10-10") => ({ id, date, amountMinor: -amount, description });

  it("links one debit to the bills that add up to it", () => {
    const m = matchCombinedSettlements([bill("domestic", 423135n), bill("abroad", 47866n), bill("other", 1000n)], [debit("d", 471001n)]);
    expect(m.map((x) => [x.billId, x.debitId]).sort()).toEqual([["abroad", "d"], ["domestic", "d"]]);
  });

  it("only combines bills of the issuer the debit names, within the date window", () => {
    expect(matchCombinedSettlements([bill("a", 1000n), bill("b", 2000n, "2026-10-10", "max")], [debit("d", 3000n)])).toEqual([]);
    expect(matchCombinedSettlements([bill("a", 1000n), bill("b", 2000n, "2026-09-01")], [debit("d", 3000n)])).toEqual([]);
    expect(matchCombinedSettlements([bill("a", 1000n), bill("b", 2000n)], [debit("d", 3000n, "העברה")])).toEqual([]);
  });

  it("never uses a bill twice", () => {
    const m = matchCombinedSettlements([bill("a", 1000n), bill("b", 2000n)], [debit("d1", 3000n), debit("d2", 3000n)]);
    expect(new Set(m.map((x) => x.billId)).size).toBe(m.length);
    expect(new Set(m.map((x) => x.debitId)).size).toBe(1);
  });
});

describe("nearMissBill", () => {
  const bills = [{ id: "mine", institution: "isracard", postingDate: "2026-10-11", totalMinor: 423135n }];
  it("finds a bill that nearly equals the debit", () => {
    expect(nearMissBill({ id: "d", date: "2026-10-11", amountMinor: -423136n, description: "ישראכרט-כ.וי-י" }, bills)?.id).toBe("mine");
    expect(nearMissBill({ id: "d", date: "2026-10-11", amountMinor: -428000n, description: "ישראכרט-כ.וי-י" }, bills)?.id).toBe("mine"); // 1.1%
  });
  it("leaves a clearly different payment alone (another card of the same issuer)", () => {
    expect(nearMissBill({ id: "d", date: "2026-10-11", amountMinor: -1246688n, description: 'ישראכרט בע"מ-י' }, bills)).toBeNull();
    expect(nearMissBill({ id: "d", date: "2026-10-11", amountMinor: -423136n, description: "מקס איט פיננ-י" }, bills)).toBeNull();
  });
});
