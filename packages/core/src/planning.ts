// Budgets, goals and forecasting: pure functions over monthly figures.
import type { RecurringSeries } from "./recurring.js";

const n = (v: bigint) => Number(v);

// --- budgets ---

export type BudgetState = "ok" | "near" | "on_pace_to_exceed" | "over";

export interface BudgetStatus {
  spentMinor: bigint;
  limitMinor: bigint;
  ratio: number;
  /** spending at this pace by month end (equals spent for a finished month) */
  projectedMinor: bigint;
  state: BudgetState;
}

/**
 * Where a budget stands on `day` of a `daysInMonth`-day month. "On pace to exceed" is only
 * called from the second week on, so one big purchase on the 2nd doesn't trigger it.
 */
export function budgetStatus(limitMinor: bigint, spentMinor: bigint, alertRatio: number, day: number, daysInMonth: number): BudgetStatus {
  const ratio = limitMinor > 0n ? n(spentMinor) / n(limitMinor) : 0;
  const projectedMinor = day >= daysInMonth ? spentMinor : (spentMinor * BigInt(daysInMonth)) / BigInt(Math.max(1, day));
  const state: BudgetState =
    spentMinor > limitMinor ? "over" : ratio >= alertRatio ? "near" : day >= 7 && n(projectedMinor) > n(limitMinor) * 1.05 ? "on_pace_to_exceed" : "ok";
  return { spentMinor, limitMinor, ratio, projectedMinor, state };
}

/** A realistic starting limit: the recent average, rounded up to the next ₪50. Null without history. */
export function suggestBudget(recentMonthlyMinor: bigint[]): bigint | null {
  const months = recentMonthlyMinor.filter((v) => v > 0n);
  if (months.length === 0) return null;
  const avg = months.reduce((a, v) => a + v, 0n) / BigInt(months.length);
  return ((avg + 4999n) / 5000n) * 5000n;
}

// --- goals ---

export type GoalType = "save_amount" | "savings_rate" | "reduce_category";

export interface GoalDefinition {
  type: GoalType;
  targetAmountMinor?: bigint | null;
  deadline?: string | null; // YYYY-MM-DD
  targetRate?: number | null;
  reducePct?: number | null;
  baselineMonthlyMinor?: bigint | null;
  startMonth: string;
}

export interface GoalMonth {
  month: string;
  incomeMinor: bigint;
  netMinor: bigint;
  /** spending in the goal's category (reduce_category) */
  categoryMinor?: bigint;
}

export interface GoalProgress {
  /** 0..1 */
  progress: number;
  state: "achieved" | "on_track" | "behind" | "no_data";
  /** save_amount: saved so far, still needed, and the monthly pace required */
  savedMinor?: bigint;
  remainingMinor?: bigint;
  requiredMonthlyMinor?: bigint | null;
  /** savings_rate: recent average rate */
  currentRate?: number;
  /** reduce_category: the target level and this month's spending */
  targetMonthlyMinor?: bigint;
  currentMonthlyMinor?: bigint;
}

function monthsUntil(fromMonth: string, toDate: string): number {
  const [fy, fm] = fromMonth.split("-").map(Number) as [number, number];
  const [ty, tm] = toDate.slice(0, 7).split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * Progress of a goal given the months from its start to the current month (chronological,
 * only months with data). The current month is the last one.
 */
export function goalProgress(goal: GoalDefinition, months: GoalMonth[]): GoalProgress {
  const relevant = months.filter((m) => m.month >= goal.startMonth);
  if (relevant.length === 0) return { progress: 0, state: "no_data" };
  const current = relevant[relevant.length - 1]!;

  if (goal.type === "save_amount") {
    const target = goal.targetAmountMinor ?? 0n;
    const saved = relevant.reduce((a, m) => a + m.netMinor, 0n);
    const remaining = target - saved;
    const progress = target > 0n ? Math.max(0, Math.min(1, n(saved) / n(target))) : 0;
    if (remaining <= 0n) return { progress: 1, state: "achieved", savedMinor: saved, remainingMinor: 0n, requiredMonthlyMinor: 0n };
    const left = goal.deadline ? monthsUntil(current.month, goal.deadline) : null;
    const required = left !== null && left > 0 ? remaining / BigInt(left) : null;
    const recent = relevant.slice(-3);
    const pace = recent.reduce((a, m) => a + m.netMinor, 0n) / BigInt(recent.length);
    const onTrack = required === null ? pace > 0n : pace >= required;
    return { progress, state: onTrack ? "on_track" : "behind", savedMinor: saved, remainingMinor: remaining, requiredMonthlyMinor: required };
  }

  if (goal.type === "savings_rate") {
    const target = goal.targetRate ?? 0;
    const recent = relevant.slice(-3).filter((m) => m.incomeMinor > 0n);
    if (recent.length === 0) return { progress: 0, state: "no_data" };
    const rate = recent.reduce((a, m) => a + n(m.netMinor) / n(m.incomeMinor), 0) / recent.length;
    const progress = target > 0 ? Math.max(0, Math.min(1, rate / target)) : 0;
    return { progress, state: rate >= target ? "achieved" : "behind", currentRate: rate };
  }

  // reduce_category
  const baseline = goal.baselineMonthlyMinor ?? 0n;
  const pct = goal.reducePct ?? 0;
  const target = BigInt(Math.round(n(baseline) * (1 - pct)));
  const spent = current.categoryMinor ?? 0n;
  const span = baseline - target;
  const progress = span > 0n ? Math.max(0, Math.min(1, n(baseline - spent) / n(span))) : spent <= target ? 1 : 0;
  return { progress, state: spent <= target ? "achieved" : progress > 0 ? "on_track" : "behind", targetMonthlyMinor: target, currentMonthlyMinor: spent };
}

// --- forecast ---

export type Adjustment =
  /** monthly change to spending (negative = spend less), e.g. "restaurants -₪500" */
  | { kind: "expense_change"; monthlyMinor: bigint }
  /** income change, e.g. a 10% raise = 0.1 */
  | { kind: "income_change"; pct: number }
  /** a new monthly payment, e.g. a car loan, optionally for a number of months */
  | { kind: "new_payment"; monthlyMinor: bigint; months?: number }
  /** move a fixed amount to savings every month (leaves the checking account, counts as saved) */
  | { kind: "extra_saving"; monthlyMinor: bigint }
  /** a one-off purchase in the given forecast month (0 = first) */
  | { kind: "one_off"; amountMinor: bigint; monthIndex: number };

export interface ForecastHistoryMonth {
  month: string;
  incomeMinor: bigint;
  expensesMinor: bigint;
}

export interface Range {
  low: bigint;
  mid: bigint;
  high: bigint;
}

export interface ForecastMonth {
  month: string;
  income: Range;
  expenses: Range;
  net: Range;
  /** cumulative net from the first forecast month */
  cumulative: Range;
  /** checking balance at month end, when a starting balance is known */
  balance: Range | null;
  /** cumulative amount moved to savings by an extra_saving scenario */
  extraSavedMinor: bigint;
}

export interface Forecast {
  status: "ok" | "insufficient";
  historyMonths: number;
  months: ForecastMonth[];
  assumptions: {
    incomeMinor: bigint;
    recurringIncomeMinor: bigint;
    fixedPaymentsMinor: bigint;
    variableSpendingMinor: bigint;
    endingInstallments: { label: string; lastMonth: string }[];
    seasonal: boolean;
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function addMonths(month: string, k: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7);
}

const big = (v: number) => BigInt(Math.round(v));

/**
 * Projects income, spending and balance month by month:
 * - known commitments: active recurring payments, and installment plans until their last payment;
 * - recurring income plus the median of other income;
 * - variable spending: the median of past spending beyond the commitments, with the 10th-90th
 *   percentile of history as the range.
 * Cumulative ranges widen with the square root of time (months assumed independent).
 * Needs at least 3 complete months of history.
 */
export function forecast(input: {
  history: ForecastHistoryMonth[];
  recurring: RecurringSeries[];
  firstMonth: string;
  horizon: number;
  startBalanceMinor: bigint | null;
  adjustments?: Adjustment[];
}): Forecast {
  const history = input.history.filter((m) => m.incomeMinor > 0n && m.expensesMinor > 0n);
  const active = input.recurring.filter((r) => r.active);
  const plans = active.filter((r) => r.direction === "out" && r.installments);
  const fixedRecurring = active.filter((r) => r.direction === "out" && !r.installments).reduce((a, r) => a + r.monthlyMinor, 0n);
  const recurringIncome = active.filter((r) => r.direction === "in").reduce((a, r) => a + r.monthlyMinor, 0n);
  const installmentsNow = plans.reduce((a, r) => a + r.amountMinor, 0n);
  const endingInstallments = plans.map((r) => ({ label: r.label, lastMonth: addMonths(input.firstMonth, r.installments!.remaining - 1) }));

  const empty: Forecast = {
    status: "insufficient",
    historyMonths: history.length,
    months: [],
    assumptions: { incomeMinor: 0n, recurringIncomeMinor: recurringIncome, fixedPaymentsMinor: fixedRecurring + installmentsNow, variableSpendingMinor: 0n, endingInstallments, seasonal: false },
  };
  if (history.length < 3) return empty;

  // what spending and income looked like beyond the known commitments
  const variable = history.map((m) => n(m.expensesMinor - fixedRecurring - installmentsNow)).map((v) => Math.max(0, v)).sort((a, b) => a - b);
  const otherIncome = history.map((m) => Math.max(0, n(m.incomeMinor - recurringIncome))).sort((a, b) => a - b);
  const varQ = { low: quantile(variable, 0.1), mid: quantile(variable, 0.5), high: quantile(variable, 0.9) };
  const incQ = { low: quantile(otherIncome, 0.1), mid: quantile(otherIncome, 0.5), high: quantile(otherIncome, 0.9) };

  const adj = input.adjustments ?? [];
  const incomeFactor = 1 + adj.filter((a): a is Extract<Adjustment, { kind: "income_change" }> => a.kind === "income_change").reduce((s, a) => s + a.pct, 0);

  const months: ForecastMonth[] = [];
  let cum = { low: 0, mid: 0, high: 0 };
  let varianceSum = 0;
  let extraSaved = 0n;
  for (let k = 0; k < input.horizon; k++) {
    const month = addMonths(input.firstMonth, k);
    const installments = plans.filter((r) => k < r.installments!.remaining).reduce((a, r) => a + n(r.amountMinor), 0);
    let extra = 0;
    let saving = 0;
    for (const a of adj) {
      if (a.kind === "expense_change") extra += n(a.monthlyMinor);
      if (a.kind === "new_payment" && (a.months === undefined || k < a.months)) extra += n(a.monthlyMinor);
      if (a.kind === "one_off" && a.monthIndex === k) extra += n(a.amountMinor);
      if (a.kind === "extra_saving") saving += n(a.monthlyMinor);
    }
    const fixed = n(fixedRecurring) + installments;
    const expenses = { low: fixed + varQ.low + extra, mid: fixed + varQ.mid + extra, high: fixed + varQ.high + extra };
    const income = {
      low: (n(recurringIncome) + incQ.low) * incomeFactor,
      mid: (n(recurringIncome) + incQ.mid) * incomeFactor,
      high: (n(recurringIncome) + incQ.high) * incomeFactor,
    };
    // net excludes money moved to savings (it is saved, not spent), but it leaves the checking account
    const net = { low: income.low - expenses.high, mid: income.mid - expenses.mid, high: income.high - expenses.low };
    cum = { low: 0, mid: cum.mid + net.mid, high: 0 };
    const halfWidth = (net.high - net.low) / 2;
    varianceSum += halfWidth * halfWidth;
    const spread = Math.sqrt(varianceSum);
    cum.low = cum.mid - spread;
    cum.high = cum.mid + spread;
    extraSaved += big(saving);
    const toRange = (r: { low: number; mid: number; high: number }): Range => ({ low: big(r.low), mid: big(r.mid), high: big(r.high) });
    months.push({
      month,
      income: toRange(income),
      expenses: toRange(expenses),
      net: toRange(net),
      cumulative: toRange(cum),
      balance:
        input.startBalanceMinor === null
          ? null
          : toRange({ low: n(input.startBalanceMinor) + cum.low - n(extraSaved), mid: n(input.startBalanceMinor) + cum.mid - n(extraSaved), high: n(input.startBalanceMinor) + cum.high - n(extraSaved) }),
      extraSavedMinor: extraSaved,
    });
  }
  return {
    status: "ok",
    historyMonths: history.length,
    months,
    assumptions: {
      incomeMinor: big(n(recurringIncome) + incQ.mid),
      recurringIncomeMinor: recurringIncome,
      fixedPaymentsMinor: fixedRecurring + installmentsNow,
      variableSpendingMinor: big(varQ.mid),
      endingInstallments,
      // a month-of-year adjustment needs at least a year of history
      seasonal: false,
    },
  };
}

