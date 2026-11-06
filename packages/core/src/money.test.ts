import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseAmount, sum, toDecimalString } from "./money.js";

describe("parseAmount", () => {
  it.each([
    ["1,234.56", 123456n],
    ["-1,234.56", -123456n],
    ["1,234.56-", -123456n],
    ["(50.10)", -5010n],
    ["₪ 12", 1200n],
    ["0.5", 50n],
  ])("%s -> %s", (input, expected) => {
    expect(parseAmount(input).minor).toBe(expected);
  });

  it("rejects garbage and excess precision", () => {
    expect(() => parseAmount("abc")).toThrow();
    expect(() => parseAmount("1.234")).toThrow();
  });

  it("round-trips through toDecimalString", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), (minor) => {
        const m = { minor, currency: "ILS" };
        expect(parseAmount(toDecimalString(m)).minor).toBe(minor);
      }),
    );
  });
});

describe("sum", () => {
  it("refuses to mix currencies", () => {
    expect(() => sum([parseAmount("1", "USD")])).toThrow(/mismatch/);
  });
});
