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
