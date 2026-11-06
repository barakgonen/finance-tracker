import { describe, expect, it } from "vitest";
import { normalizeDescription, similarity } from "./merchant.js";

describe("normalizeDescription", () => {
  it("collapses branch variants of the same merchant", () => {
    const a = normalizeDescription("שופרסל דיל 123 ת\"א").key;
    const b = normalizeDescription("שופרסל דיל-456 ת\"א").key;
    expect(a).toBe(b);
  });

  it("strips payment processors and records them", () => {
    const r = normalizeDescription("PAYPAL *NETFLIX.COM");
    expect(r.processor).toBe("paypal");
    expect(r.key).toBe("netflix com");
  });

  it("flags P2P wallets", () => {
    expect(normalizeDescription("העברה ב-BIT").isP2P).toBe(true);
    expect(normalizeDescription("פייבוקס").isP2P).toBe(true);
    expect(normalizeDescription("רמי לוי").isP2P).toBe(false);
  });
});

describe("similarity", () => {
  it("is 1 for identical and 0 for disjoint", () => {
    expect(similarity("rami levy", "rami levy")).toBe(1);
    expect(similarity("rami levy", "netflix")).toBe(0);
  });
});
