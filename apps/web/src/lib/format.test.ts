import { describe, expect, it } from "vitest";
import { compactMoney, parseShekels } from "./format";

describe("parseShekels", () => {
  it("reads shekel amounts from form input into agorot", () => {
    expect(parseShekels("1250")).toBe(125000n);
    expect(parseShekels("1,250.5")).toBe(125050n);
    expect(parseShekels("₪ 99.99")).toBe(9999n);
  });
  it("rejects empty, negative, and over-precise input", () => {
    expect(parseShekels("")).toBeNull();
    expect(parseShekels("-5")).toBeNull();
    expect(parseShekels("1.234")).toBeNull();
    expect(parseShekels("abc")).toBeNull();
    expect(parseShekels(null)).toBeNull();
  });
});

describe("compactMoney", () => {
  it("abbreviates axis values", () => {
    expect(compactMoney(0)).toBe("₪0");
    expect(compactMoney(1250000)).toBe("₪12.5K");
    expect(compactMoney(-12000000)).toBe("−₪120K");
  });
});
