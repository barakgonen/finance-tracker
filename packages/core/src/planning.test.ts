import { describe, expect, it } from "vitest";
import { budgetStatus, forecast, goalProgress, suggestBudget, type ForecastHistoryMonth } from "./planning.js";
import type { RecurringSeries } from "./recurring.js";

describe("budgets", () => {
  it("is ok, near, on pace to exceed, or over", () => {
    expect(budgetStatus(300000n, 100000n, 0.8, 15, 30).state).toBe("ok");
    expect(budgetStatus(300000n, 250000n, 0.8, 20, 30).state).toBe("near");
    expect(budgetStatus(300000n, 200000n, 0.8, 10, 30)).toMatchObject({ state: "on_pace_to_exceed", projectedMinor: 600000n });
    expect(budgetStatus(300000n, 312000n, 0.8, 25, 30).state).toBe("over");
  });

  it("doesn't cry wolf in the first week", () => {
    expect(budgetStatus(300000n, 150000n, 0.8, 2, 30).state).toBe("ok");
  });

  it("suggests the recent average rounded up to ₪50, and nothing without history", () => {
    expect(suggestBudget([249000n, 312000n, 0n])).toBe(285000n); // avg 280,500 -> 2,850
    expect(suggestBudget([])).toBeNull();
  });
});

describe("goals", () => {
  const months = (nets: number[], start = 7) => nets.map((net, i) => ({ month: `2026-${String(start + i).padStart(2, "0")}`, incomeMinor: 1000000n, netMinor: BigInt(net) }));

  it("tracks saving an amount by a deadline", () => {
    const p = goalProgress({ type: "save_amount", targetAmountMinor: 5000000n, deadline: "2027-06-30", startMonth: "2026-07" }, months([200000, 300000, 250000]));
    expect(p).toMatchObject({ savedMinor: 750000n, remainingMinor: 4250000n, requiredMonthlyMinor: 472222n, state: "behind" }); // Oct-Jun: 9 months left
    expect(p.progress).toBeCloseTo(0.15, 2);
  });

  it("marks a reached savings goal achieved and ignores months before its start", () => {
    const p = goalProgress({ type: "save_amount", targetAmountMinor: 500000n, startMonth: "2026-08" }, months([900000, 300000, 250000]));
    expect(p).toMatchObject({ state: "achieved", savedMinor: 550000n, progress: 1 });
  });

  it("tracks a savings-rate target over the recent months", () => {
    const p = goalProgress({ type: "savings_rate", targetRate: 0.2, startMonth: "2026-07" }, months([100000, 150000, 200000]));
    expect(p).toMatchObject({ state: "behind" });
    expect(p.currentRate).toBeCloseTo(0.15, 3);
    expect(p.progress).toBeCloseTo(0.75, 3);
  });

  it("tracks cutting a category against its baseline", () => {
    const def = { type: "reduce_category" as const, reducePct: 0.15, baselineMonthlyMinor: 300000n, startMonth: "2026-07" };
    const at = (spent: number) => goalProgress(def, [{ month: "2026-07", incomeMinor: 0n, netMinor: 0n, categoryMinor: BigInt(spent) }]);
    expect(at(240000)).toMatchObject({ state: "achieved", targetMonthlyMinor: 255000n, progress: 1 });
    expect(at(277500).progress).toBeCloseTo(0.5, 3);
    expect(at(320000)).toMatchObject({ state: "behind", progress: 0 });
  });

  it("reports no data before the goal's first month", () => {
    expect(goalProgress({ type: "savings_rate", targetRate: 0.2, startMonth: "2027-01" }, months([1, 2, 3])).state).toBe("no_data");
  });
});

describe("forecast", () => {
  const hist = (rows: [number, number][]): ForecastHistoryMonth[] => rows.map(([i, e], k) => ({ month: `2026-0${k + 6}`, incomeMinor: BigInt(i), expensesMinor: BigInt(e) }));
  const series = (over: Partial<RecurringSeries>): RecurringSeries => ({
    key: "k", label: "x", cadence: "monthly", direction: "out", amountMinor: 0n, amountVariation: 0, occurrences: 4, firstDate: "", lastDate: "", nextDate: "",
    monthlyMinor: 0n, annualMinor: 0n, active: true, confidence: "high", lastAmountMinor: 0n, previousTypicalMinor: null, transactionIds: [], ...over,
  });
  const base = {
    history: hist([[1500000, 1000000], [1500000, 1200000], [1500000, 1100000]]),
    recurring: [
      series({ label: "salary", direction: "in", monthlyMinor: 1500000n, amountMinor: 1500000n }),
      series({ label: "mortgage", monthlyMinor: 400000n, amountMinor: 400000n }),
      series({ label: "sofa", monthlyMinor: 100000n, amountMinor: 100000n, installments: { paid: 2, total: 4, remaining: 2 } }),
    ],
    firstMonth: "2026-09",
    horizon: 4,
    startBalanceMinor: 2000000n,
  };

  it("refuses to forecast from fewer than three complete months", () => {
    expect(forecast({ ...base, history: base.history.slice(0, 2) }).status).toBe("insufficient");
  });

  it("projects commitments, drops installments after their last payment, and ranges the rest", () => {
    const f = forecast(base);
    expect(f.status).toBe("ok");
    // variable spending = past spending minus commitments now (4,000 + 1,000): 5,000 / 7,000 / 6,000 -> median 6,000
    expect(f.assumptions.variableSpendingMinor).toBe(600000n);
    expect(f.months.map((m) => m.expenses.mid)).toEqual([1100000n, 1100000n, 1000000n, 1000000n]); // the sofa ends after 2 months
    expect(f.months[0]!.net.mid).toBe(400000n);
    expect(f.months[0]!.expenses.low < f.months[0]!.expenses.high).toBe(true);
    expect(f.assumptions.endingInstallments).toEqual([{ label: "sofa", lastMonth: "2026-10" }]);
  });

  it("widens the cumulative range over time and projects the balance from the real starting balance", () => {
    const f = forecast(base);
    const w = (i: number) => f.months[i]!.cumulative.high - f.months[i]!.cumulative.low;
    expect(w(3) > w(0)).toBe(true);
    expect(f.months[3]!.balance!.mid).toBe(2000000n + f.months[3]!.cumulative.mid);
    expect(forecast({ ...base, startBalanceMinor: null }).months[0]!.balance).toBeNull();
  });

  it("applies what-if scenarios", () => {
    const baseline = forecast(base).months[3]!;
    const cut = forecast({ ...base, adjustments: [{ kind: "expense_change", monthlyMinor: -50000n }] }).months[3]!;
    expect(cut.cumulative.mid - baseline.cumulative.mid).toBe(200000n); // ₪500 x 4 months
    const raise = forecast({ ...base, adjustments: [{ kind: "income_change", pct: 0.1 }] }).months[0]!;
    expect(raise.income.mid).toBe(1650000n);
    const car = forecast({ ...base, adjustments: [{ kind: "new_payment", monthlyMinor: 250000n, months: 2 }] }).months;
    expect(car[0]!.expenses.mid - forecast(base).months[0]!.expenses.mid).toBe(250000n);
    expect(car[2]!.expenses.mid).toBe(forecast(base).months[2]!.expenses.mid);
    const save = forecast({ ...base, adjustments: [{ kind: "extra_saving", monthlyMinor: 100000n }] }).months[3]!;
    expect(save.extraSavedMinor).toBe(400000n);
    expect(baseline.balance!.mid - save.balance!.mid).toBe(400000n);
    const trip = forecast({ ...base, adjustments: [{ kind: "one_off", amountMinor: 1500000n, monthIndex: 1 }] }).months;
    expect(trip[1]!.net.mid).toBe(forecast(base).months[1]!.net.mid - 1500000n);
  });
});
