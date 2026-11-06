import { describe, expect, it } from "vitest";
import { classify, ruleFromCorrection, type ClassifyInput } from "./classify.js";
import { ISSUER_CATEGORY_MAP, MERCHANT_ENTRIES, BANK_ENTRIES, words } from "./dictionary.js";
import { CATEGORY_SLUGS } from "./categories.js";

const card = (description: string, amountMinor = -1000n, extra: Partial<ClassifyInput> = {}): ClassifyInput => ({
  description,
  amountMinor,
  accountType: "credit_card",
  ...extra,
});
const bank = (description: string, amountMinor: bigint): ClassifyInput => ({ description, amountMinor, accountType: "bank" });

describe("dictionary integrity", () => {
  it("only references categories that exist", () => {
    const used = [
      ...Object.values(ISSUER_CATEGORY_MAP),
      ...[...MERCHANT_ENTRIES, ...BANK_ENTRIES].map((e) => e.category).filter((c): c is string => !!c),
    ];
    expect(used.filter((c) => !CATEGORY_SLUGS.has(c))).toEqual([]);
  });

  it("matches Hebrew whole words only", () => {
    const re = words("ביט|פז");
    expect(re.test("הפועלים-ביט")).toBe(true);
    expect(re.test("פז אפליקציית יילו")).toBe(true);
    expect(re.test("ביטוח")).toBe(false);
    expect(re.test("פזגז")).toBe(false);
  });
});

describe("classify", () => {
  it("recognizes common merchants", () => {
    expect(classify(card("רמי לוי - נשר")).category).toBe("groceries");
    expect(classify(card("WOLT")).category).toBe("delivery");
    expect(classify(card("AIRBNB * HMABC123")).category).toBe("travel");
    expect(classify(card("חברת החשמל לישראל בע")).category).toBe("utilities");
  });

  it("does not confuse substrings (רמי is not the water utility, ביטוח is not ביט)", () => {
    expect(classify(card("רמי לוי")).category).toBe("groceries");
    expect(classify(bank("ביטוח ישיר", -5000n)).kind).not.toBe("p2p_transfer");
  });

  it("is most confident when merchant name and issuer label agree", () => {
    const c = classify(card("סונול דניה", -20000n, { categoryHint: "דלק" }));
    expect(c).toMatchObject({ category: "fuel", source: "dictionary", needsReview: false });
    expect(c.confidence).toBeGreaterThan(0.95);
  });

  it("falls back to the issuer label for unknown merchants and ignores vague labels", () => {
    expect(classify(card("נדב קינוחים", -3800n, { categoryHint: "מעדניות" })).category).toBe("groceries");
    expect(classify(card("אבוטבול ברברי", -8000n, { categoryHint: "שונות" }))).toMatchObject({ category: null, needsReview: true });
  });

  it("does not mistake the Pais benefits club for gambling, nor appliance repair for health", () => {
    expect(classify(card("פיס פלוס -תו נטען", -9900n, { categoryHint: "שיווק ישיר" })).category).toBe("shopping");
    expect(classify(card("פיס מנויים", -6000n, { categoryHint: "טוטו/פיס" })).category).toBe("lottery");
    expect(classify(card("שרות סימנס בוש קונסטרוקטה", -30000n, { categoryHint: "רפואה ובריאות" })).category).toBe("home");
  });

  it("money in from a known merchant is a refund in that category, not income", () => {
    expect(classify(bank("הראל חברה לביטוח", 50000n))).toMatchObject({ kind: "refund", category: "insurance" });
  });

  it("treats card credits as refunds", () => {
    expect(classify(card("KSP", 2800n, { typeHint: "זיכוי" })).kind).toBe("refund");
    expect(classify(card("מקום לא מוכר", 2800n)).kind).toBe("refund");
  });

  it("classifies bank movements by kind", () => {
    expect(classify(bank("פיקדון*", -250000n)).kind).toBe("savings_investment");
    expect(classify(bank("פרעון פקדון", 250000n)).kind).toBe("savings_investment");
    expect(classify(bank('קנית ני"ע', -100000n)).kind).toBe("savings_investment");
    expect(classify(bank("פרעון הלוואה", -120000n)).kind).toBe("loan_payment");
    expect(classify(bank("לאומי למשכנת-י", -400000n)).kind).toBe("loan_payment");
    expect(classify(bank("הפועלים-ביט", 100000n)).kind).toBe("p2p_transfer");
    expect(classify(bank('דמי ניהול ני"ע', -1500n))).toMatchObject({ kind: "fee", category: "bank_fees" });
    expect(classify(bank("גביה/החזר מס", 272n))).toMatchObject({ kind: "income", category: "tax_refund" });
  });

  it("flags unconfirmed card-bill debits for review until the settlement matcher confirms them", () => {
    expect(classify(bank("ישראכרט-כ.וי-י", -111100n))).toMatchObject({ kind: "card_settlement", needsReview: true });
  });

  it("sends unknown incoming transfers to review as possible income", () => {
    expect(classify(bank("חברה כלשהי בעמ-י", 1500000n))).toMatchObject({ kind: "income", category: null, needsReview: true });
  });

  it("user rules win over everything", () => {
    const rule = ruleFromCorrection("r1", "חברה כלשהי בעמ-י", { kind: "income", category: "salary" });
    expect(classify(bank("חברה כלשהי בעמ-י", 1500000n), { rules: [rule] })).toMatchObject({
      kind: "income",
      category: "salary",
      source: "rule",
      needsReview: false,
    });
    const override = { id: "r2", priority: 1, conditions: { descriptionRegex: "רמי לוי" }, actions: { category: "home" } };
    expect(classify(card("רמי לוי"), { rules: [override] }).category).toBe("home");
  });

  it("applies merchant mappings and learns from similar past corrections", () => {
    const merchants = new Map([["אבוטבול ברברי", { category: "personal_care" }]]);
    expect(classify(card("אבוטבול ברברי"), { merchants })).toMatchObject({ category: "personal_care", source: "merchant" });

    // a corrected branch teaches other branches of the same business
    const examples = [{ key: "יגור חקלאות ועסקים", kind: "expense" as const, category: "groceries" }];
    expect(classify(card("יגור חקלאות ועסקים א"), { examples })).toMatchObject({ category: "groceries", source: "neighbour" });
  });
});
