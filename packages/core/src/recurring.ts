// Detects recurring payments and income from transaction history. Conservative by design: a
// pattern needs at least three occurrences at a regular interval with a stable amount, so it
// never claims a "subscription" from two coincidences. Installment plans are recurring by
// definition and come with a known end.

export type Cadence = "weekly" | "monthly" | "bimonthly" | "yearly";

export interface RecurringInput {
  id: string;
  /** what identifies "the same payment": merchant id, or normalized description */
  key: string;
  label: string;
  date: string; // YYYY-MM-DD
  amountMinor: bigint; // signed
  installmentNo?: number | null;
  installmentTotal?: number | null;
  /** the purchase price of an installment plan; identifies the plan (per-payment amounts vary by agorot) */
  installmentOriginalMinor?: bigint | null;
}

export interface RecurringSeries {
  key: string;
  label: string;
  cadence: Cadence;
  direction: "in" | "out";
  /** typical amount (median), positive */
  amountMinor: bigint;
  /** largest relative deviation from the typical amount among occurrences (0.05 = 5%) */
  amountVariation: number;
  occurrences: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  /** normalized to a month, positive */
  monthlyMinor: bigint;
  annualMinor: bigint;
  active: boolean;
  confidence: "high" | "medium";
  /** the most recent amount vs the typical one before it (price changes) */
  lastAmountMinor: bigint;
  previousTypicalMinor: bigint | null;
  transactionIds: string[];
  installments?: { paid: number; total: number; remaining: number };
}

const CADENCES: { cadence: Cadence; days: number; min: number; max: number; perYear: number }[] = [
  { cadence: "weekly", days: 7, min: 5, max: 9, perYear: 52 },
  { cadence: "monthly", days: 30.4, min: 24, max: 37, perYear: 12 },
  { cadence: "bimonthly", days: 60.8, min: 52, max: 70, perYear: 6 },
  { cadence: "yearly", days: 365, min: 340, max: 390, perYear: 1 },
];

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const abs = (v: bigint) => (v < 0n ? -v : v);

function median(values: bigint[]): bigint {
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2n;
}

function medianNum(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Amounts may vary (utility bills) but not wildly: within 30% of the typical amount. */
const MAX_VARIATION = 0.3;

export function detectRecurring(transactions: RecurringInput[], asOf: string): RecurringSeries[] {
  const out: RecurringSeries[] = [];
  const groups = new Map<string, RecurringInput[]>();
  for (const t of transactions) {
    if (t.amountMinor === 0n) continue;
    const dir = t.amountMinor < 0n ? "out" : "in";
    // installment plans group per plan: same merchant, same number of payments, same purchase price
    // (or the per-payment amount to the shekel, since issuers spread rounding agorot across payments)
    const planId = t.installmentOriginalMinor ? abs(t.installmentOriginalMinor) : (abs(t.amountMinor) + 50n) / 100n;
    const plan = t.installmentTotal && t.installmentTotal > 1 ? `|plan:${t.installmentTotal}:${planId}` : "";
    const k = `${dir}|${t.key}${plan}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  for (const [groupKey, items] of groups) {
    // payments of one plan share the purchase date, so order by payment number as well
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || (a.installmentNo ?? 0) - (b.installmentNo ?? 0));
    const direction = groupKey.startsWith("out") ? "out" : "in";
    const last = sorted[sorted.length - 1]!;

    // installment plans: the statement says how many remain, so no inference is needed
    if (last.installmentTotal && last.installmentTotal > 1 && last.installmentNo) {
      const remaining = last.installmentTotal - last.installmentNo;
      const amount = abs(last.amountMinor);
      out.push({
        key: groupKey,
        label: last.label,
        cadence: "monthly",
        direction,
        amountMinor: amount,
        amountVariation: 0,
        occurrences: sorted.length,
        firstDate: sorted[0]!.date,
        lastDate: last.date,
        nextDate: addDays(last.date, 30),
        monthlyMinor: remaining > 0 ? amount : 0n,
        annualMinor: amount * BigInt(Math.min(12, remaining)),
        active: remaining > 0,
        confidence: "high",
        lastAmountMinor: amount,
        previousTypicalMinor: null,
        transactionIds: sorted.map((t) => t.id),
        installments: { paid: last.installmentNo, total: last.installmentTotal, remaining },
      });
      continue;
    }

    // collapse same-day duplicates of a series (e.g. a charge and its correction) into one occurrence
    const occurrences = sorted.filter((t, i) => i === 0 || t.date !== sorted[i - 1]!.date);
    if (occurrences.length < 3) continue;
    const intervals = occurrences.slice(1).map((t, i) => days(occurrences[i]!.date, t.date));
    const typicalInterval = medianNum(intervals);
    const cadence = CADENCES.find((c) => typicalInterval >= c.min && typicalInterval <= c.max);
    if (!cadence) continue;
    // every gap must fit the cadence (allowing one skipped period); otherwise it's irregular
    if (!intervals.every((d) => (d >= cadence.min && d <= cadence.max) || (d >= cadence.min * 2 && d <= cadence.max * 2))) continue;

    const amounts = occurrences.map((t) => abs(t.amountMinor));
    const typical = median(amounts);
    if (typical === 0n) continue;
    const variation = Math.max(...amounts.map((a) => Math.abs(Number(a - typical)) / Number(typical)));
    if (variation > MAX_VARIATION) continue;

    const before = amounts.slice(0, -1);
    const lastAmount = amounts[amounts.length - 1]!;
    const nextDate = addDays(last.date, Math.round(cadence.days));
    const overdueBy = days(nextDate, asOf);
    const monthly = (typical * BigInt(Math.round(cadence.perYear * 100))) / 1200n;
    out.push({
      key: groupKey,
      label: last.label,
      cadence: cadence.cadence,
      direction,
      amountMinor: typical,
      amountVariation: variation,
      occurrences: occurrences.length,
      firstDate: occurrences[0]!.date,
      lastDate: last.date,
      nextDate,
      monthlyMinor: monthly,
      annualMinor: typical * BigInt(cadence.perYear),
      // a series is still active until it misses a whole period
      active: overdueBy <= cadence.days * 0.5,
      confidence: occurrences.length >= 4 && variation <= 0.05 ? "high" : "medium",
      lastAmountMinor: lastAmount,
      previousTypicalMinor: before.length >= 2 ? median(before) : null,
      transactionIds: occurrences.map((t) => t.id),
    });
  }
  return out.sort((a, b) => (b.monthlyMinor > a.monthlyMinor ? 1 : b.monthlyMinor < a.monthlyMinor ? -1 : 0));
}
