// Turns analytics into prioritized, explainable findings. Each detector states what it found,
// the money involved, how sure it is, and which transactions support it; a detector without
// enough history stays silent rather than guessing. Wording is left to the UI (detector + params).
import type { RecurringSeries } from "./recurring.js";

export type Confidence = "high" | "medium" | "low";

export interface Insight {
  /** stable id, so a dismissal can be remembered */
  id: string;
  detector: "category_spike" | "subscriptions" | "price_increase" | "duplicate_charge" | "unusual_transaction" | "savings_drop";
  params: Record<string, string | number>;
  /** money involved per month (recurring effects) */
  monthlyImpactMinor: bigint | null;
  /** money involved once (a duplicate charge, an unusual purchase) */
  oneOffMinor: bigint | null;
  confidence: Confidence;
  evidence: string[];
  /** for drill-down links */
  categorySlug?: string;
  merchantKey?: string;
}

export interface InsightCategory {
  slug: string;
  name: string;
  minor: bigint;
  avg3Minor: bigint | null;
}

export interface InsightTransaction {
  id: string;
  date: string;
  label: string;
  merchantKey: string | null;
  amountMinor: bigint; // signed
  categorySlug: string | null;
  installmentNo: number | null;
}

export interface InsightInputs {
  month: string;
  categories: InsightCategory[];
  /** months of history available before `month` (0-3) */
  historyMonths: number;
  recurring: (RecurringSeries & { categorySlug: string | null })[];
  /** the month's spending transactions */
  transactions: InsightTransaction[];
  /** per category: median absolute amount of single transactions in earlier months, and how many */
  categoryNorms: Map<string, { medianMinor: bigint; count: number }>;
  /** income and net for this month and the preceding months that have data */
  incomeMinor: bigint;
  netMinor: bigint;
  previousNet: { incomeMinor: bigint; netMinor: bigint }[];
}

/** Categories that don't describe what was bought: no spending advice about them. */
const NOT_ACTIONABLE = new Set(["uncategorized", "card_unitemized"]);
const SUBSCRIPTION_LIKE = new Set(["subscriptions", "communication", "entertainment", "sports"]);
const WEIGHT: Record<Confidence, number> = { high: 1, medium: 0.6, low: 0.3 };

const abs = (v: bigint) => (v < 0n ? -v : v);

export function detectInsights(i: InsightInputs): Insight[] {
  const out: Insight[] = [];

  // 1. a category well above its own recent average
  if (i.historyMonths > 0) {
    for (const c of i.categories) {
      // a baseline under ₪100 isn't a habit to compare against (and makes percentages absurd)
      if (NOT_ACTIONABLE.has(c.slug) || c.avg3Minor === null || c.avg3Minor < 10000n) continue;
      const diff = c.minor - c.avg3Minor;
      if (diff >= 20000n && c.minor * 100n >= c.avg3Minor * 125n) {
        out.push({
          id: `category_spike:${i.month}:${c.slug}`,
          detector: "category_spike",
          params: { category: c.name, current: Number(c.minor), average: Number(c.avg3Minor), percent: Math.round((Number(diff) / Number(c.avg3Minor)) * 100), months: i.historyMonths },
          monthlyImpactMinor: diff,
          oneOffMinor: null,
          confidence: i.historyMonths >= 3 ? "high" : "medium",
          evidence: i.transactions.filter((t) => t.categorySlug === c.slug).map((t) => t.id),
          categorySlug: c.slug,
        });
      }
    }
  }

  // 2. what subscriptions cost together
  const subs = i.recurring.filter((r) => r.active && r.direction === "out" && !r.installments && r.categorySlug && SUBSCRIPTION_LIKE.has(r.categorySlug));
  if (subs.length >= 2) {
    const monthly = subs.reduce((a, r) => a + r.monthlyMinor, 0n);
    out.push({
      id: `subscriptions:${i.month}`,
      detector: "subscriptions",
      params: { count: subs.length, monthly: Number(monthly), annual: Number(monthly * 12n), names: subs.map((s) => s.label).join(", ") },
      monthlyImpactMinor: monthly,
      oneOffMinor: null,
      confidence: "high",
      evidence: subs.flatMap((s) => s.transactionIds.slice(-1)),
    });
  }

  // 3. a recurring payment that got more expensive
  for (const r of i.recurring) {
    if (!r.active || r.direction !== "out" || r.installments || r.previousTypicalMinor === null) continue;
    const diff = r.lastAmountMinor - r.previousTypicalMinor;
    if (diff >= 500n && r.lastAmountMinor * 100n >= r.previousTypicalMinor * 105n) {
      out.push({
        id: `price_increase:${r.key}:${r.lastDate}`,
        detector: "price_increase",
        params: { name: r.label, before: Number(r.previousTypicalMinor), now: Number(r.lastAmountMinor), percent: Math.round((Number(diff) / Number(r.previousTypicalMinor)) * 100) },
        monthlyImpactMinor: (diff * r.monthlyMinor) / (r.amountMinor || 1n),
        oneOffMinor: null,
        confidence: r.confidence,
        evidence: r.transactionIds.slice(-2),
      });
    }
  }

  // 4. the same amount charged twice by the same merchant within a day
  const seen = new Set<string>();
  const charges = i.transactions.filter((t) => t.amountMinor <= -5000n && t.merchantKey && t.installmentNo === null);
  for (const a of charges) {
    for (const b of charges) {
      if (a.id >= b.id || a.merchantKey !== b.merchantKey || a.amountMinor !== b.amountMinor) continue;
      if (Math.abs(Date.parse(a.date) - Date.parse(b.date)) > 86_400_000) continue;
      const id = `duplicate_charge:${[a.id, b.id].sort().join(":")}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        detector: "duplicate_charge",
        params: { name: a.label, amount: Number(abs(a.amountMinor)), date: a.date },
        monthlyImpactMinor: null,
        oneOffMinor: abs(a.amountMinor),
        confidence: "medium",
        evidence: [a.id, b.id],
        merchantKey: a.merchantKey!,
      });
    }
  }

  // 5. a purchase far above what that category usually costs
  for (const t of i.transactions) {
    if (!t.categorySlug || NOT_ACTIONABLE.has(t.categorySlug) || t.installmentNo !== null) continue;
    const norm = i.categoryNorms.get(t.categorySlug);
    const amount = abs(t.amountMinor);
    if (!norm || norm.count < 5 || amount < 30000n || amount <= norm.medianMinor * 3n) continue;
    out.push({
      id: `unusual_transaction:${t.id}`,
      detector: "unusual_transaction",
      params: { name: t.label, amount: Number(amount), typical: Number(norm.medianMinor), times: Math.round(Number(amount) / Number(norm.medianMinor)) },
      monthlyImpactMinor: null,
      oneOffMinor: amount,
      confidence: norm.count >= 15 ? "high" : "medium",
      evidence: [t.id],
      categorySlug: t.categorySlug,
    });
  }

  // 6. saving less than usual
  const prior = i.previousNet.filter((p) => p.incomeMinor > 0n);
  if (i.incomeMinor > 0n && prior.length >= 2) {
    const avgNet = prior.reduce((a, p) => a + p.netMinor, 0n) / BigInt(prior.length);
    const rate = Number(i.netMinor) / Number(i.incomeMinor);
    const avgRate = prior.reduce((a, p) => a + Number(p.netMinor) / Number(p.incomeMinor), 0) / prior.length;
    if (avgNet - i.netMinor >= 50000n && avgRate - rate >= 0.1) {
      out.push({
        id: `savings_drop:${i.month}`,
        detector: "savings_drop",
        params: { rate: Math.round(rate * 100), average: Math.round(avgRate * 100), months: prior.length },
        monthlyImpactMinor: avgNet - i.netMinor,
        oneOffMinor: null,
        confidence: prior.length >= 3 ? "high" : "medium",
        evidence: [],
      });
    }
  }

  // highest expected impact first; one-off amounts weigh as a month's worth spread over a year
  const score = (x: Insight) => Number(x.monthlyImpactMinor ?? (x.oneOffMinor ?? 0n) / 12n) * WEIGHT[x.confidence];
  return out.sort((a, b) => score(b) - score(a));
}
