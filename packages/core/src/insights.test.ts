import { describe, expect, it } from "vitest";
import { detectInsights, type InsightInputs } from "./insights.js";
import type { RecurringSeries } from "./recurring.js";

const base = (over: Partial<InsightInputs> = {}): InsightInputs => ({
  month: "2026-10",
  categories: [],
  historyMonths: 3,
  recurring: [],
  transactions: [],
  categoryNorms: new Map(),
  incomeMinor: 0n,
  netMinor: 0n,
  previousNet: [],
  ...over,
});
const series = (over: Partial<RecurringSeries & { categorySlug: string | null }>): RecurringSeries & { categorySlug: string | null } => ({
  key: "k", label: "Netflix", cadence: "monthly", direction: "out", amountMinor: 4990n, amountVariation: 0, occurrences: 4,
  firstDate: "2026-06-01", lastDate: "2026-09-01", nextDate: "2026-10-01", monthlyMinor: 4990n, annualMinor: 59880n, active: true,
  confidence: "high", lastAmountMinor: 4990n, previousTypicalMinor: 4990n, transactionIds: ["a", "b"], categorySlug: "subscriptions", ...over,
});
const tx = (id: string, agorot: number, over: Record<string, unknown> = {}) => ({
  id, date: "2026-10-05", label: "shop", merchantKey: "m1", amountMinor: BigInt(agorot), categorySlug: "shopping", installmentNo: null, ...over,
});

describe("detectInsights", () => {
  it("flags a category 25%+ and ₪200+ above its average, ignoring vague categories", () => {
    const out = detectInsights(base({
      categories: [
        { slug: "dining", name: "מסעדות", minor: 312000n, avg3Minor: 249000n },
        { slug: "groceries", name: "סופר", minor: 260000n, avg3Minor: 250000n },
        { slug: "card_unitemized", name: "לא מפורט", minor: 900000n, avg3Minor: 100000n },
      ],
    }));
    expect(out.map((x) => x.detector)).toEqual(["category_spike"]);
    expect(out[0]).toMatchObject({ categorySlug: "dining", monthlyImpactMinor: 63000n, params: { percent: 25 }, confidence: "high" });
  });

  it("ignores a spike over a negligible baseline", () => {
    expect(detectInsights(base({ categories: [{ slug: "travel", name: "x", minor: 101385n, avg3Minor: 1n }] }))).toEqual([]);
  });

  it("says nothing about spikes without history", () => {
    expect(detectInsights(base({ historyMonths: 0, categories: [{ slug: "dining", name: "x", minor: 900000n, avg3Minor: null }] }))).toEqual([]);
  });

  it("totals subscriptions only when there are at least two active ones", () => {
    expect(detectInsights(base({ recurring: [series({})] }))).toEqual([]);
    const [s] = detectInsights(base({ recurring: [series({}), series({ key: "s", label: "Spotify", monthlyMinor: 2390n })] }));
    expect(s).toMatchObject({ detector: "subscriptions", monthlyImpactMinor: 7380n, params: { count: 2, annual: 88560 } });
  });

  it("notices a price increase on a recurring payment", () => {
    const [p] = detectInsights(base({ recurring: [series({ categorySlug: "insurance", lastAmountMinor: 5490n, previousTypicalMinor: 4990n })] }));
    expect(p).toMatchObject({ detector: "price_increase", params: { percent: 10 } });
  });

  it("flags the same amount at the same merchant within a day as a possible duplicate", () => {
    const out = detectInsights(base({ transactions: [tx("a", -24900), tx("b", -24900, { date: "2026-10-06" }), tx("c", -24900, { date: "2026-10-20" })] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ detector: "duplicate_charge", oneOffMinor: 24900n, evidence: ["a", "b"], confidence: "medium" });
  });

  it("does not call small repeats or installments duplicates", () => {
    expect(detectInsights(base({ transactions: [tx("a", -1500), tx("b", -1500)] }))).toEqual([]);
    expect(detectInsights(base({ transactions: [tx("a", -50000, { installmentNo: 1 }), tx("b", -50000, { installmentNo: 1 })] }))).toEqual([]);
  });

  it("flags a purchase far above its category's usual amount, given enough history", () => {
    const norms = new Map([["shopping", { medianMinor: 10000n, count: 12 }]]);
    const [u] = detectInsights(base({ transactions: [tx("a", -60000)], categoryNorms: norms }));
    expect(u).toMatchObject({ detector: "unusual_transaction", params: { times: 6 } });
    expect(detectInsights(base({ transactions: [tx("a", -60000)], categoryNorms: new Map([["shopping", { medianMinor: 10000n, count: 3 }]]) }))).toEqual([]);
  });

  it("notices a savings drop against earlier months", () => {
    const [d] = detectInsights(base({
      incomeMinor: 1000000n,
      netMinor: 50000n,
      previousNet: [{ incomeMinor: 1000000n, netMinor: 250000n }, { incomeMinor: 1000000n, netMinor: 300000n }],
    }));
    expect(d).toMatchObject({ detector: "savings_drop", params: { rate: 5, average: 28 }, monthlyImpactMinor: 225000n });
  });

  it("ranks by impact weighted by confidence", () => {
    const out = detectInsights(base({
      categories: [{ slug: "dining", name: "x", minor: 100000n, avg3Minor: 50000n }],
      recurring: [series({}), series({ key: "s", monthlyMinor: 2390n })],
    }));
    expect(out.map((x) => x.detector)).toEqual(["category_spike", "subscriptions"]);
  });
});
