// Budgets, goals and forecasts over the household's data (logic in @ft/core planning).
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { budgetStatus, forecast, goalProgress, suggestBudget, type Adjustment, type BudgetStatus, type Forecast, type GoalProgress } from "@ft/core";
import { account, balanceSnapshot, budget, category, goal, transaction, transactionSplit, type Db } from "@ft/db";
import { categoryBreakdown, lineAmount, lineCategoryId, monthlySeries, spendingWhere, splitJoin, type Filters } from "./index.js";
import { recurringSeries } from "./intelligence.js";
import { monthRange, shiftMonth } from "./months.js";

/** Day of month to judge pace by: today for the current month, the last day for past months. */
function dayOfMonth(month: string): { day: number; days: number } {
  const { from, to } = monthRange(month);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  const today = new Date().toISOString().slice(0, 10);
  const day = today.slice(0, 7) === month ? Number(today.slice(8)) : today < from ? 0 : days;
  return { day, days };
}

async function categorySpend(db: Db, f: Filters, categoryId: string, month: string): Promise<bigint> {
  const { from, to } = monthRange(month);
  const [r] = await db
    .select({ total: sql<string>`coalesce(-sum(${lineAmount}), 0)` })
    .from(transaction)
    .leftJoin(transactionSplit, splitJoin)
    .where(and(spendingWhere(f, from, to), sql`${lineCategoryId} = ${categoryId}`));
  return BigInt(r?.total ?? "0");
}

export interface BudgetRow {
  id: string;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  memberId: string | null;
  alertRatio: number;
  status: BudgetStatus;
}

/** The view's budgets (household budgets, or one member's) with this month's status. */
export async function budgetsWithStatus(db: Db, f: Filters, month: string): Promise<BudgetRow[]> {
  const rows = await db
    .select({ b: budget, slug: category.slug, name: category.nameHe })
    .from(budget)
    .innerJoin(category, eq(category.id, budget.categoryId))
    .where(and(eq(budget.householdId, f.householdId), f.memberId ? eq(budget.memberId, f.memberId) : isNull(budget.memberId)))
    .orderBy(category.nameHe);
  const { day, days } = dayOfMonth(month);
  const out: BudgetRow[] = [];
  for (const { b, slug, name } of rows) {
    const spent = await categorySpend(db, { householdId: f.householdId, memberId: b.memberId ?? undefined }, b.categoryId, month);
    out.push({
      id: b.id,
      categoryId: b.categoryId,
      categorySlug: slug,
      categoryName: name,
      memberId: b.memberId,
      alertRatio: b.alertRatio,
      status: budgetStatus(b.monthlyLimit, spent, b.alertRatio, day, days),
    });
  }
  const order = { over: 0, near: 1, on_pace_to_exceed: 2, ok: 3 };
  return out.sort((a, c) => order[a.status.state] - order[c.status.state]);
}

/** Suggested limits for spending categories, from the last three months (for creating budgets). */
export async function budgetSuggestions(db: Db, f: Filters, month: string) {
  const months = [shiftMonth(month, -3), shiftMonth(month, -2), shiftMonth(month, -1)];
  const perMonth = await Promise.all(months.map((m) => categoryBreakdown(db, f, m)));
  const slugs = new Map<string, { name: string; values: bigint[] }>();
  perMonth.forEach((cats, i) => {
    for (const c of cats) {
      if (c.slug === "uncategorized" || c.slug === "card_unitemized") continue;
      const e = slugs.get(c.slug) ?? { name: c.nameHe, values: [0n, 0n, 0n] };
      e.values[i] = c.minor;
      slugs.set(c.slug, e);
    }
  });
  return [...slugs.entries()]
    .map(([slug, e]) => ({ slug, name: e.name, suggestedMinor: suggestBudget(e.values) }))
    .filter((s) => s.suggestedMinor !== null)
    .sort((a, b) => (b.suggestedMinor! > a.suggestedMinor! ? 1 : -1));
}

export interface GoalRow {
  goal: typeof goal.$inferSelect;
  categoryName: string | null;
  progress: GoalProgress;
}

/** Active goals of the view (shared goals, or one member's) with progress as of `month`. */
export async function goalsWithProgress(db: Db, f: Filters, month: string): Promise<GoalRow[]> {
  const rows = await db
    .select({ g: goal, categoryName: category.nameHe })
    .from(goal)
    .leftJoin(category, eq(category.id, goal.categoryId))
    .where(and(eq(goal.householdId, f.householdId), eq(goal.status, "active"), f.memberId ? eq(goal.memberId, f.memberId) : isNull(goal.memberId)))
    .orderBy(goal.createdAt);
  const out: GoalRow[] = [];
  for (const { g, categoryName } of rows) {
    const scope: Filters = { householdId: f.householdId, memberId: g.memberId ?? undefined };
    if (g.startMonth > month) {
      out.push({ goal: g, categoryName, progress: { progress: 0, state: "no_data" } });
      continue;
    }
    const series = (await monthlySeries(db, scope, g.startMonth, month)).filter((m) => m.transactionCount > 0);
    const months = [];
    for (const m of series) {
      months.push({
        month: m.month,
        incomeMinor: m.incomeMinor,
        netMinor: m.netMinor,
        ...(g.type === "reduce_category" && g.categoryId ? { categoryMinor: await categorySpend(db, scope, g.categoryId, m.month) } : {}),
      });
    }
    out.push({
      goal: g,
      categoryName,
      progress: goalProgress(
        {
          type: g.type,
          targetAmountMinor: g.targetAmount,
          deadline: g.deadline,
          targetRate: g.targetRate,
          reducePct: g.reducePct,
          baselineMonthlyMinor: g.baselineMonthly,
          startMonth: g.startMonth,
        },
        months,
      ),
    });
  }
  return out;
}

/** Average progress of the view's active goals that have data, or null without any. */
export async function averageGoalProgress(db: Db, f: Filters, month: string): Promise<number | null> {
  const goals = (await goalsWithProgress(db, f, month)).filter((g) => g.progress.state !== "no_data");
  return goals.length ? goals.reduce((a, g) => a + g.progress.progress, 0) / goals.length : null;
}

/** Latest known balance of the view's bank accounts by the end of `month`; null if none is known. */
export async function liquidBalance(db: Db, f: Filters, month: string): Promise<bigint | null> {
  const banks = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.householdId, f.householdId), eq(account.type, "bank"), f.memberId ? eq(account.ownerMemberId, f.memberId) : undefined));
  const lastDay = new Date(Date.parse(monthRange(month).to) - 86_400_000).toISOString().slice(0, 10);
  let total: bigint | null = null;
  for (const b of banks) {
    const [snap] = await db
      .select({ balance: balanceSnapshot.balance })
      .from(balanceSnapshot)
      .where(and(eq(balanceSnapshot.accountId, b.id), lte(balanceSnapshot.asOf, lastDay)))
      .orderBy(desc(balanceSnapshot.asOf), desc(balanceSnapshot.createdAt))
      .limit(1);
    if (snap) total = (total ?? 0n) + snap.balance;
  }
  return total;
}

/** Forecast for the months after `month`, from the six months up to it. */
export async function forecastFrom(db: Db, f: Filters, month: string, horizon: number, adjustments: Adjustment[] = []): Promise<Forecast> {
  const history = await monthlySeries(db, f, shiftMonth(month, -5), month);
  return forecast({
    history: history.map((m) => ({ month: m.month, incomeMinor: m.incomeMinor, expensesMinor: m.expensesMinor })),
    recurring: await recurringSeries(db, f, month),
    firstMonth: shiftMonth(month, 1),
    horizon,
    startBalanceMinor: await liquidBalance(db, f, month),
    adjustments,
  });
}

