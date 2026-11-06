import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fingerprintBatch, matchPendingToPosted, type FingerprintInput } from "./fingerprint.js";

const row = (over: Partial<FingerprintInput> = {}): FingerprintInput => ({
  accountId: "acc-1",
  purchaseDate: "2026-10-01",
  amountMinor: -1500n,
  currency: "ILS",
  descriptionRaw: "ארומה 12",
  ...over,
});

describe("fingerprintBatch", () => {
  it("keeps identical same-day rows distinct", () => {
    const [a, b] = fingerprintBatch([row(), row()]);
    expect(a).not.toBe(b);
  });

  it("keeps successive installments of one purchase distinct", () => {
    const [a] = fingerprintBatch([row({ installmentNo: 1 })]);
    const [b] = fingerprintBatch([row({ installmentNo: 2 })]);
    expect(a).not.toBe(b);
    // and leaves rows without installments unchanged
    expect(fingerprintBatch([row()])).toEqual(fingerprintBatch([row({ installmentNo: undefined })]));
  });

  it("ignores branch-number noise", () => {
    const [a] = fingerprintBatch([row({ descriptionRaw: "ארומה 12" })]);
    const [b] = fingerprintBatch([row({ descriptionRaw: "ארומה 99" })]);
    expect(a).toBe(b);
  });

  it("re-importing a statement reproduces the same fingerprints (no duplicates)", () => {
    const arb = fc.array(
      fc.record({
        purchaseDate: fc.constantFrom("2026-10-01", "2026-10-02"),
        amountMinor: fc.constantFrom(-1500n, -2000n),
        descriptionRaw: fc.constantFrom("ארומה", "רמי לוי"),
      }),
      { maxLength: 30 },
    );
    fc.assert(
      fc.property(arb, (rows) => {
        const full = rows.map((r) => row(r));
        const first = fingerprintBatch(full);
        expect(fingerprintBatch(full)).toEqual(first);
        expect(new Set(first).size).toBe(first.length);
      }),
    );
  });
});

describe("matchPendingToPosted", () => {
  const pending = [
    { id: "p1", purchaseDate: "2026-10-01", amountMinor: -1500n, descriptionRaw: "ARCAFFE TLV" },
    { id: "p2", purchaseDate: "2026-10-01", amountMinor: -9900n, descriptionRaw: "ARCAFFE TLV" },
  ];

  it("matches by amount, date window, and description", () => {
    expect(
      matchPendingToPosted({ purchaseDate: "2026-10-03", amountMinor: -1500n, descriptionRaw: "ARCAFFE TLV 5" }, pending),
    ).toBe("p1");
  });

  it("does not match outside the date window", () => {
    expect(
      matchPendingToPosted({ purchaseDate: "2026-10-10", amountMinor: -1500n, descriptionRaw: "ARCAFFE TLV" }, pending),
    ).toBeNull();
  });
});
