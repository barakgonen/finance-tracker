// Financial health score (0-100). Transparent by construction: every dimension is a linear map
// from one measured value onto 0-100 between a "worst" and a "best" threshold, the overall score
// is a weighted average of the dimensions that have data, and all thresholds and weights live in
// one config. Missing data yields "insufficient data", never a guessed score.

export type HealthDimensionKey =
  | "savings_rate"
  | "expense_ratio"
  | "cashflow_stability"
  | "fixed_costs"
  | "spending_consistency"
  | "debt"
  | "emergency_fund"
  | "goals";

export interface DimensionConfig {
  weight: number;
  /** value at which the score is 0, and at which it is 100 (either may be the larger) */
  worst: number;
  best: number;
}

export const HEALTH_CONFIG = {
  /** complete months (income and spending both present) required for an overall score */
  minMonths: 3,
  /** scored dimensions required for an overall score */
  minDimensions: 4,
  /** above this share of unreviewed (guessed) amounts, confidence is low */
  unreviewedWarnShare: 0.25,
  dimensions: {
    savings_rate: { weight: 25, worst: 0, best: 0.2 }, // share of income left at month end
    expense_ratio: { weight: 15, worst: 1, best: 0.6 }, // spending / income
    cashflow_stability: { weight: 15, worst: 0.5, best: 1 }, // share of months ending positive
    fixed_costs: { weight: 10, worst: 0.7, best: 0.3 }, // recurring commitments / income
    spending_consistency: { weight: 10, worst: 0.5, best: 0.1 }, // coefficient of variation of monthly spending
    debt: { weight: 10, worst: 0.4, best: 0 }, // loan and mortgage payments / income
    emergency_fund: { weight: 15, worst: 0, best: 6 }, // months of spending covered by the bank balance
    goals: { weight: 0, worst: 0, best: 1 }, // average goal progress (no goals feature yet: weight 0)
  } satisfies Record<HealthDimensionKey, DimensionConfig>,
};

export type HealthConfig = typeof HEALTH_CONFIG;

export interface HealthMonth {
  month: string;
  incomeMinor: bigint;
  expensesMinor: bigint;
  loanPaymentsMinor: bigint;
  /** absolute amount of unreviewed income + spending */
  unreviewedMinor: bigint;
}

export interface HealthInputs {
  /** chronological; only months with both income and spending are used */
  months: HealthMonth[];
  /** active recurring payments and installment plans, per month */
  fixedMonthlyMinor: bigint | null;
  /** latest bank balance(s) at the end of the period; null when no balance is known */
  liquidBalanceMinor: bigint | null;
  /** whether bank statements were imported at all (needed to judge debt payments) */
  hasBankData: boolean;
  /** average progress of active goals (0..1), or null without goals */
  goalProgress: number | null;
}

export interface HealthDimension {
  key: HealthDimensionKey;
  score: number | null;
  /** the measured value the score is based on (null without data) */
  value: number | null;
  weight: number;
  effect: "positive" | "negative" | "neutral" | "unknown";
  /** why there is no score, when there isn't */
  missing?: "too_few_months" | "no_income" | "no_balance" | "no_bank_data" | "no_goals";
}

export interface HealthResult {
  total: number | null;
  /** why there is no total, when there isn't */
  insufficient?: "too_few_months" | "too_few_dimensions";
  monthsUsed: number;
  confidence: "high" | "medium" | "low";
  unreviewedShare: number;
  dimensions: HealthDimension[];
  /** the weakest scored dimensions, worst first: what to improve */
  focus: HealthDimensionKey[];
}

/** Linear 0-100 between worst and best, clamped. */
export function scoreBetween(value: number, c: Pick<DimensionConfig, "worst" | "best">): number {
  const t = (value - c.worst) / (c.best - c.worst);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

const n = (v: bigint) => Number(v);

export function computeHealth(inputs: HealthInputs, config: HealthConfig = HEALTH_CONFIG): HealthResult {
  const months = inputs.months.filter((m) => m.incomeMinor > 0n && m.expensesMinor > 0n);
  const enough = months.length >= config.minMonths;
  const income = months.reduce((a, m) => a + n(m.incomeMinor), 0);
  const spending = months.reduce((a, m) => a + n(m.expensesMinor), 0);
  const avgIncome = months.length ? income / months.length : 0;
  const avgSpending = months.length ? spending / months.length : 0;

  const dims: HealthDimension[] = [];
  const add = (key: HealthDimensionKey, value: number | null, missing?: HealthDimension["missing"]) => {
    const c = config.dimensions[key];
    const score = value === null ? null : scoreBetween(value, c);
    dims.push({
      key,
      value,
      score,
      weight: c.weight,
      effect: score === null ? "unknown" : score >= 70 ? "positive" : score <= 40 ? "negative" : "neutral",
      ...(value === null ? { missing } : {}),
    });
  };

  add("savings_rate", enough ? (income - spending) / income : null, "too_few_months");
  add("expense_ratio", enough ? spending / income : null, "too_few_months");
  add("cashflow_stability", enough ? months.filter((m) => m.incomeMinor > m.expensesMinor).length / months.length : null, "too_few_months");
  add("fixed_costs", enough && inputs.fixedMonthlyMinor !== null ? n(inputs.fixedMonthlyMinor) / avgIncome : null, enough ? "no_income" : "too_few_months");
  if (enough) {
    const sd = Math.sqrt(months.reduce((a, m) => a + (n(m.expensesMinor) - avgSpending) ** 2, 0) / months.length);
    add("spending_consistency", sd / avgSpending);
  } else add("spending_consistency", null, "too_few_months");
  add(
    "debt",
    enough && inputs.hasBankData ? months.reduce((a, m) => a + n(m.loanPaymentsMinor), 0) / months.length / avgIncome : null,
    enough ? "no_bank_data" : "too_few_months",
  );
  add("emergency_fund", inputs.liquidBalanceMinor !== null && avgSpending > 0 ? Math.max(0, n(inputs.liquidBalanceMinor)) / avgSpending : null, inputs.liquidBalanceMinor === null ? "no_balance" : "too_few_months");
  add("goals", inputs.goalProgress, "no_goals");

  const scored = dims.filter((d) => d.score !== null && d.weight > 0);
  const weight = scored.reduce((a, d) => a + d.weight, 0);
  const total = enough && scored.length >= config.minDimensions && weight > 0 ? Math.round(scored.reduce((a, d) => a + d.score! * d.weight, 0) / weight) : null;
  const unreviewedShare = income + spending > 0 ? months.reduce((a, m) => a + n(m.unreviewedMinor), 0) / (income + spending) : 0;
  const confidence = unreviewedShare > config.unreviewedWarnShare ? "low" : months.length >= 6 && scored.length >= 6 ? "high" : "medium";

  return {
    total,
    ...(total === null ? { insufficient: enough ? "too_few_dimensions" : "too_few_months" } : {}),
    monthsUsed: months.length,
    confidence,
    unreviewedShare,
    dimensions: dims,
    focus: scored.filter((d) => d.score! < 60).sort((a, b) => a.score! - b.score!).slice(0, 2).map((d) => d.key),
  };
}
