import { describe, expect, it } from "vitest";
import { hebrewReason } from "./reason-text";

describe("hebrewReason", () => {
  it("translates the settlement reasons, with amounts as money", () => {
    expect(hebrewReason("statement for my Cal not imported yet")).toBe("הדוח של my Cal עוד לא יובא");
    const near = hebrewReason("bank charge 5440.00 differs from the my Cal statement total 5432.10");
    expect(near).toContain("my Cal");
    expect(near).toMatch(/5,440\.00/);
    expect(near).toMatch(/5,432\.10/);
    expect(hebrewReason("pays 2 card bills")).toBe("תשלום 2 דוחות כרטיס");
    expect(hebrewReason("pays my Cal bill of 2026-11-02")).toBe("תשלום הדוח של my Cal מ-02.11.2026");
  });

  it("leaves unknown reasons as they are", () => {
    expect(hebrewReason("משכורת")).toBe("משכורת");
  });
});
