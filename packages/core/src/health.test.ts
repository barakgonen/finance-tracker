import { describe, expect, it } from "vitest";
import { computeHealth, HEALTH_CONFIG, scoreBetween, type HealthInputs, type HealthMonth } from "./health.js";

const month = (i: number, income: number, expenses: number, extra: Partial<HealthMonth> = {}): HealthMonth => ({
  month: `2026-${String(i).padStart(2, "0")}`,
  incomeMinor: BigInt(income),
  expensesMinor: BigInt(expenses),
  loanPaymentsMinor: 0n,
  unreviewedMinor: 0n,
  ...extra,
});
const inputs = (over: Partial<HealthInputs> = {}): HealthInputs => ({
  months: [month(1, 1000000, 800000), month(2, 1000000, 800000), month(3, 1000000, 800000)],
  fixedMonthlyMinor: 300000n,
  liquidBalanceMinor: 2400000n,
  hasBankData: true,
  goalProgress: null,
  ...over,
});

describe("scoreBetween", () => {
  it("maps linearly between worst and best, clamped, in either direction", () => {
    expect(scoreBetween(0.1, { worst: 0, best: 0.2 })).toBe(50);
    expect(scoreBetween(0.5, { worst: 0, best: 0.2 })).toBe(100);
    expect(scoreBetween(-0.1, { worst: 0, best: 0.2 })).toBe(0);
    expect(scoreBetween(0.8, { worst: 1, best: 0.6 })).toBe(50); // lower is better
  });
});

describe("computeHealth", () => {
  it("scores each dimension from its measured value and averages by weight", () => {
    const r = computeHealth(inputs());
    const by = Object.fromEntries(r.dimensions.map((d) => [d.key, d]));
    expect(by.savings_rate).toMatchObject({ value: 0.2, score: 100, effect: "positive" });
    expect(by.expense_ratio).toMatchObject({ value: 0.8, score: 50, effect: "neutral" });
    expect(by.cashflow_stability).toMatchObject({ value: 1, score: 100 });
    expect(by.fixed_costs).toMatchObject({ value: 0.3, score: 100 });
    expect(by.spending_consistency).toMatchObject({ value: 0, score: 100 });
    expect(by.debt).toMatchObject({ value: 0, score: 100 });
    expect(by.emergency_fund).toMatchObject({ value: 3, score: 50 });
    expect(by.goals).toMatchObject({ score: null, missing: "no_goals" });
    // goals have no data, so: (100*20 + 50*15 + 100*15 + 100*10 + 100*10 + 100*10 + 50*10) / 90
    expect(r.total).toBe(86);
  });

  it("refuses an overall score with fewer than three complete months", () => {
    const r = computeHealth(inputs({ months: [month(1, 1000000, 800000), month(2, 0, 800000), month(3, 1000000, 0)] }));
    expect(r).toMatchObject({ total: null, insufficient: "too_few_months", monthsUsed: 1 });
    expect(r.dimensions.find((d) => d.key === "savings_rate")).toMatchObject({ score: null, missing: "too_few_months" });
  });

  it("leaves out dimensions without data and re-weights the rest", () => {
    const r = computeHealth(inputs({ liquidBalanceMinor: null, hasBankData: false }));
    expect(r.dimensions.find((d) => d.key === "emergency_fund")).toMatchObject({ score: null, missing: "no_balance" });
    expect(r.dimensions.find((d) => d.key === "debt")).toMatchObject({ score: null, missing: "no_bank_data" });
    // (100*20 + 50*15 + 100*15 + 100*10 + 100*10) / 70
    expect(r.total).toBe(89);
  });

  it("penalizes deficits, unstable months, debt and volatile spending, and names what to fix", () => {
    const r = computeHealth(
      inputs({
        months: [month(1, 1000000, 1200000, { loanPaymentsMinor: 400000n }), month(2, 1000000, 600000, { loanPaymentsMinor: 400000n }), month(3, 1000000, 1300000, { loanPaymentsMinor: 400000n })],
        fixedMonthlyMinor: 700000n,
        liquidBalanceMinor: 0n,
      }),
    );
    expect(r.total).toBeLessThan(30);
    expect(r.focus.length).toBe(2);
    expect(r.dimensions.filter((d) => d.effect === "negative").length).toBeGreaterThanOrEqual(4);
  });

  it("lowers confidence when much of the data is still unreviewed", () => {
    const r = computeHealth(inputs({ months: inputs().months.map((m) => ({ ...m, unreviewedMinor: 900000n })) }));
    expect(r.confidence).toBe("low");
    expect(r.unreviewedShare).toBeCloseTo(0.5, 2);
  });

  it("counts goal progress once there are goals", () => {
    const r = computeHealth(inputs({ goalProgress: 0.5 }));
    expect(r.dimensions.find((d) => d.key === "goals")).toMatchObject({ score: 50, value: 0.5 });
    expect(r.total).toBe(83); // (7750 + 50*10) / 100
  });

  it("the default weights of scored dimensions sum to 100", () => {
    expect(Object.values(HEALTH_CONFIG.dimensions).reduce((a, d) => a + d.weight, 0)).toBe(100);
  });
});
