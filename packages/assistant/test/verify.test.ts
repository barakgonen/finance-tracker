import { describe, expect, it } from "vitest";
import { LABELS } from "../src/prompt.js";
import { labelParagraphs, numbersIn, numbersStated, verifyAnswer } from "../src/verify.js";

describe("verifyAnswer", () => {
  const results = [JSON.stringify([{ slug: "dining", amount: 3120.4, share_of_month: 0.108, previous_month: -2490 }])];

  it("traces amounts and percentages to tool results, allowing for rounding and sign", () => {
    expect(verifyAnswer("עובדה: הוצאתם ₪3,120 על מסעדות, 11% מההוצאות, לעומת ₪2,490 בחודש הקודם.", results)).toEqual({ checked: 3, untraced: [] });
  });

  it("flags numbers that appear in no tool result", () => {
    expect(verifyAnswer("עובדה: הוצאתם ₪4,800 על מסעדות.", results).untraced).toEqual(["4,800"]);
  });

  it("ignores dates, years and small counts", () => {
    expect(numbersStated("ב-15.10.2026, ב-2026-10 ובשנת 2026, 3 חודשים")).toEqual([]);
  });

  it("reads numbers anywhere in nested results and skips error text", () => {
    expect(numbersIn([JSON.stringify({ a: { b: [1500.5] } }), "Invalid input: month"])).toContain(1500.5);
  });
});

describe("labelParagraphs", () => {
  it("splits an answer into labelled paragraphs", () => {
    const parts = labelParagraphs("עובדה: הוצאתם ₪3,120.\n\nהמלצה: להגביל משלוחים.\n\nבלי תווית.", LABELS);
    expect(parts).toEqual([
      { kind: "fact", text: "הוצאתם ₪3,120." },
      { kind: "recommendation", text: "להגביל משלוחים." },
      { kind: null, text: "בלי תווית." },
    ]);
  });
});
