// Gathers the inputs for the health score (see computeHealth in @ft/core) over a 6-month window.
import { and, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { computeHealth, type HealthResult } from "@ft/core";
import { account, balanceSnapshot, transaction, type Db } from "@ft/db";
import { monthlySeries, type Filters } from "./index.js";
import { recurringSeries } from "./intelligence.js";
import { monthRange, shiftMonth } from "./months.js";

const WINDOW = 6;

export async function healthScore(db: Db, f: Filters, month: string): Promise<HealthResult> {
  const first = shiftMonth(month, -(WINDOW - 1));
  const { from } = monthRange(first);
  const { to } = monthRange(month);
  const monthOf = sql<string>`to_char(${transaction.purchaseDate}, 'YYYY-MM')`;
  const scope = and(
    eq(transaction.householdId, f.householdId),
    isNull(transaction.supersededById),
    eq(transaction.status, "posted"),
    gte(transaction.purchaseDate, from),
    lt(transaction.purchaseDate, to),
    f.memberId ? eq(transaction.memberId, f.memberId) : undefined,
  );

  const series = await monthlySeries(db, f, first, month);
  const loans = await db
    .select({ month: monthOf, total: sql<string>`coalesce(-sum(${transaction.amount}), 0)` })
    .from(transaction)
    .where(and(scope, eq(transaction.kind, "loan_payment")))
    .groupBy(monthOf);
  const loanBy = new Map(loans.map((l) => [l.month, BigInt(l.total)]));

  const [bankRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transaction)
    .innerJoin(account, eq(account.id, transaction.accountId))
    .where(and(scope, eq(account.type, "bank")));

  const recurring = await recurringSeries(db, f, month);
  const fixed = recurring.filter((s) => s.active && s.direction === "out").reduce((a, s) => a + s.monthlyMinor, 0n);

  // latest known balance of each bank account by the end of the month (the member's own accounts in an individual view)
  const banks = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.householdId, f.householdId), eq(account.type, "bank"), f.memberId ? eq(account.ownerMemberId, f.memberId) : undefined));
  let liquid: bigint | null = null;
  if (banks.length > 0) {
    const lastDay = new Date(Date.parse(to) - 86_400_000).toISOString().slice(0, 10);
    for (const b of banks) {
      const [snap] = await db
        .select({ balance: balanceSnapshot.balance })
        .from(balanceSnapshot)
        .where(and(eq(balanceSnapshot.accountId, b.id), lte(balanceSnapshot.asOf, lastDay)))
        .orderBy(desc(balanceSnapshot.asOf), desc(balanceSnapshot.createdAt))
        .limit(1);
      if (snap) liquid = (liquid ?? 0n) + snap.balance;
    }
  }

  return computeHealth({
    months: series.map((m) => ({
      month: m.month,
      incomeMinor: m.incomeMinor,
      expensesMinor: m.expensesMinor,
      loanPaymentsMinor: loanBy.get(m.month) ?? 0n,
      unreviewedMinor: (m.unreviewedIncomeMinor < 0n ? -m.unreviewedIncomeMinor : m.unreviewedIncomeMinor) + (m.unreviewedExpensesMinor < 0n ? -m.unreviewedExpensesMinor : m.unreviewedExpensesMinor),
    })),
    fixedMonthlyMinor: fixed,
    liquidBalanceMinor: liquid,
    hasBankData: (bankRow?.n ?? 0) > 0,
    goalProgress: null,
  });
}

/** The score as it stood at the end of each of the last `n` months. */
export async function healthHistory(db: Db, f: Filters, month: string, n = 6): Promise<{ month: string; total: number | null; confidence: string }[]> {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = shiftMonth(month, -i);
    const r = await healthScore(db, f, m);
    out.push({ month: m, total: r.total, confidence: r.confidence });
  }
  return out;
}

