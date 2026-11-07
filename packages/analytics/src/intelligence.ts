// Recurring payments, upcoming charges, merchant details and insights, built on the shared
// spending/income definitions in ./index.
import { and, eq, inArray, lt, gte, sql } from "drizzle-orm";
import { detectInsights, detectRecurring, INCOME_KINDS, SPENDING_KINDS, type Insight, type RecurringSeries, type TransactionKind } from "@ft/core";
import { category, insightState, merchant, transaction, type Db } from "@ft/db";
import { categoryBreakdown, detailsVisible, monthlySeries, spendingWhere, type Filters } from "./index.js";
import { monthRange, monthsBetween, shiftMonth } from "./months.js";

export type RecurringWithCategory = RecurringSeries & { categorySlug: string | null; categoryName: string | null; merchantId: string | null };

const KINDS = [...SPENDING_KINDS, ...INCOME_KINDS] as TransactionKind[];

/** Recurring series detected in the 13 months up to and including `month`. */
export async function recurringSeries(db: Db, f: Filters, month: string): Promise<RecurringWithCategory[]> {
  const { from } = monthRange(shiftMonth(month, -12));
  const { to } = monthRange(month);
  const rows = await db
    .select({
      id: transaction.id,
      date: sql<string>`${transaction.purchaseDate}::text`,
      amount: transaction.amount,
      merchantId: transaction.merchantId,
      merchantName: merchant.name,
      descriptionNorm: transaction.descriptionNorm,
      description: transaction.descriptionRaw,
      installmentNo: transaction.installmentNo,
      installmentTotal: transaction.installmentTotal,
      installmentOriginal: transaction.installmentOriginalAmount,
      categorySlug: category.slug,
      categoryName: category.nameHe,
    })
    .from(transaction)
    .leftJoin(merchant, eq(merchant.id, transaction.merchantId))
    .leftJoin(category, eq(category.id, transaction.categoryId))
    .where(
      and(
        eq(transaction.householdId, f.householdId),
        eq(transaction.status, "posted"),
        sql`${transaction.supersededById} is null`,
        gte(transaction.purchaseDate, from),
        lt(transaction.purchaseDate, to),
        inArray(transaction.kind, KINDS),
        f.memberId ? eq(transaction.memberId, f.memberId) : undefined,
        detailsVisible(f),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  // judge "still active" at the end of the month, or today for the current month
  const lastDay = shiftDay(to, -1);
  const today = new Date().toISOString().slice(0, 10);
  const asOf = lastDay < today ? lastDay : today;
  const series = detectRecurring(
    rows.map((r) => ({
      id: r.id,
      key: r.merchantId ?? r.descriptionNorm,
      label: r.merchantName ?? r.description,
      date: r.date,
      amountMinor: r.amount,
      installmentNo: r.installmentNo,
      installmentTotal: r.installmentTotal,
      installmentOriginalMinor: r.installmentOriginal,
    })),
    asOf,
  );
  return series.map((s) => {
    // the category most of the series' transactions carry
    const counts = new Map<string, { n: number; name: string | null }>();
    for (const id of s.transactionIds) {
      const r = byId.get(id)!;
      if (r.categorySlug) counts.set(r.categorySlug, { n: (counts.get(r.categorySlug)?.n ?? 0) + 1, name: r.categoryName });
    }
    const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    return { ...s, categorySlug: top?.[0] ?? null, categoryName: top?.[1].name ?? null, merchantId: byId.get(s.transactionIds[0]!)!.merchantId };
  });
}

function shiftDay(iso: string, n: number): string {
  return new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Expected payments (and income) in the next `days` days, from active recurring series. */
export function upcoming(series: RecurringWithCategory[], fromDate: string, days = 30) {
  const until = shiftDay(fromDate, days);
  return series
    .filter((s) => s.active && s.nextDate >= fromDate && s.nextDate <= until)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

/** Prioritized insights for a month (see detectInsights for the rules). */
export async function monthInsights(db: Db, f: Filters, month: string): Promise<Insight[]> {
  const [categories, history, recurring, coverage] = [
    await categoryBreakdown(db, f, month),
    await monthlySeries(db, f, shiftMonth(month, -3), month),
    await recurringSeries(db, f, month),
    await accountCoverage(db, f, shiftMonth(month, -3), month),
  ];
  const current = history[history.length - 1]!;
  // Only months with statements for every account active this month are comparable: otherwise a
  // missing card statement would look like a drop, and this month like a spike.
  const active = coverage.get(month) ?? new Set<string>();
  const prior = history
    .slice(0, -1)
    .filter((m) => m.transactionCount > 0 && [...active].every((a) => coverage.get(m.month)?.has(a)));
  const priorCategories = await Promise.all(prior.map((m) => categoryBreakdown(db, f, m.month)));
  const averageOf = (slug: string): bigint | null => {
    if (prior.length === 0) return null;
    const total = priorCategories.reduce((a, cats) => a + (cats.find((c) => c.slug === slug)?.minor ?? 0n), 0n);
    return total / BigInt(prior.length);
  };
  const { from, to } = monthRange(month);
  const monthTx = await db
    .select({
      id: transaction.id,
      date: sql<string>`${transaction.purchaseDate}::text`,
      label: sql<string>`coalesce(${merchant.name}, ${transaction.descriptionRaw})`,
      merchantKey: transaction.merchantId,
      amountMinor: transaction.amount,
      categorySlug: category.slug,
      installmentNo: transaction.installmentNo,
    })
    .from(transaction)
    .leftJoin(merchant, eq(merchant.id, transaction.merchantId))
    .leftJoin(category, eq(category.id, transaction.categoryId))
    .where(and(spendingWhere(f, from, to), detailsVisible(f)));

  // typical single-purchase size per category over the six months before
  const norms = await db
    .select({
      slug: category.slug,
      median: sql<string>`percentile_disc(0.5) within group (order by -${transaction.amount})`,
      count: sql<number>`count(*)::int`,
    })
    .from(transaction)
    .innerJoin(category, eq(category.id, transaction.categoryId))
    .where(and(spendingWhere(f, monthRange(shiftMonth(month, -6)).from, from), lt(transaction.amount, 0n)))
    .groupBy(category.slug);

  return detectInsights({
    month,
    categories: categories.map((c) => ({ slug: c.slug, name: c.nameHe, minor: c.minor, avg3Minor: averageOf(c.slug) })),
    historyMonths: prior.length,
    recurring,
    transactions: monthTx,
    categoryNorms: new Map(norms.map((n) => [n.slug, { medianMinor: BigInt(n.median), count: n.count }])),
    incomeMinor: current.incomeMinor,
    netMinor: current.netMinor,
    previousNet: prior.map((p) => ({ incomeMinor: p.incomeMinor, netMinor: p.netMinor })),
  });
}

export interface MerchantDetail {
  id: string;
  name: string;
  defaultCategoryId: string | null;
  months: { month: string; minor: bigint; count: number }[];
  totalMinor: bigint;
  count: number;
  avgMinor: bigint;
  commonAmounts: { amountMinor: bigint; count: number }[];
  categories: { slug: string | null; name: string | null; count: number }[];
}

/** Twelve months of spending at one merchant. */
export async function merchantDetail(db: Db, f: Filters, merchantId: string, month: string): Promise<MerchantDetail | null> {
  const [m] = await db.select().from(merchant).where(and(eq(merchant.id, merchantId), eq(merchant.householdId, f.householdId)));
  if (!m) return null;
  // a merchant known only from someone else's private account stays hidden, name included
  const [seen] = await db
    .select({ all: sql<number>`count(*)::int`, visible: sql<number>`(count(*) filter (where ${detailsVisible(f) ?? sql`true`}))::int` })
    .from(transaction)
    .where(eq(transaction.merchantId, merchantId));
  if (seen && seen.all > 0 && seen.visible === 0) return null;
  const first = shiftMonth(month, -11);
  const where = and(spendingWhere(f, monthRange(first).from, monthRange(month).to), eq(transaction.merchantId, merchantId), detailsVisible(f));
  const monthOf = sql<string>`to_char(${transaction.purchaseDate}, 'YYYY-MM')`;
  const perMonth = await db
    .select({ month: monthOf, total: sql<string>`coalesce(-sum(${transaction.amount}), 0)`, count: sql<number>`count(*)::int` })
    .from(transaction)
    .where(where)
    .groupBy(monthOf);
  const amounts = await db
    .select({ amount: sql<string>`-${transaction.amount}`, count: sql<number>`count(*)::int` })
    .from(transaction)
    .where(where)
    .groupBy(transaction.amount)
    .orderBy(sql`count(*) desc`, sql`-${transaction.amount} desc`)
    .limit(3);
  const cats = await db
    .select({ slug: category.slug, name: category.nameHe, count: sql<number>`count(*)::int` })
    .from(transaction)
    .leftJoin(category, eq(category.id, transaction.categoryId))
    .where(where)
    .groupBy(category.slug, category.nameHe)
    .orderBy(sql`count(*) desc`);
  const byMonth = new Map(perMonth.map((r) => [r.month, r]));
  const months = monthsBetween(first, month).map((mm) => ({ month: mm, minor: BigInt(byMonth.get(mm)?.total ?? "0"), count: byMonth.get(mm)?.count ?? 0 }));
  const totalMinor = months.reduce((a, x) => a + x.minor, 0n);
  const count = months.reduce((a, x) => a + x.count, 0);
  return {
    id: m.id,
    name: m.name,
    defaultCategoryId: m.defaultCategoryId,
    months,
    totalMinor,
    count,
    avgMinor: count ? totalMinor / BigInt(count) : 0n,
    commonAmounts: amounts.filter((a) => a.count > 1).map((a) => ({ amountMinor: BigInt(a.amount), count: a.count })),
    categories: cats,
  };
}

/** Merchants of the household the viewer may see, for pickers (merge target). */
export async function merchantList(db: Db, f: Filters) {
  const hidden = detailsVisible(f);
  return db
    .select({ id: merchant.id, name: merchant.name })
    .from(merchant)
    .where(
      and(
        eq(merchant.householdId, f.householdId),
        sql`${merchant.mergedIntoId} is null`,
        // leave out merchants seen only on other members' private accounts
        hidden
          ? sql`(not exists (select 1 from ${transaction} where ${transaction.merchantId} = ${merchant.id}) or exists (select 1 from ${transaction} where ${transaction.merchantId} = ${merchant.id} and ${hidden}))`
          : undefined,
      ),
    )
    .orderBy(merchant.name);
}

/** Which accounts have any transaction in each month (a proxy for "this statement was imported"). */
async function accountCoverage(db: Db, f: Filters, first: string, last: string): Promise<Map<string, Set<string>>> {
  const monthOf = sql<string>`to_char(${transaction.purchaseDate}, 'YYYY-MM')`;
  const rows = await db
    .selectDistinct({ month: monthOf, accountId: transaction.accountId })
    .from(transaction)
    .where(
      and(
        eq(transaction.householdId, f.householdId),
        gte(transaction.purchaseDate, monthRange(first).from),
        lt(transaction.purchaseDate, monthRange(last).to),
        f.memberId ? eq(transaction.memberId, f.memberId) : undefined,
      ),
    );
  const out = new Map<string, Set<string>>();
  for (const r of rows) out.set(r.month, (out.get(r.month) ?? new Set()).add(r.accountId));
  return out;
}

/** How the household marked each insight (handled / not relevant), by insight id. */
export async function insightStates(db: Db, householdId: string): Promise<Map<string, "done" | "dismissed">> {
  const rows = await db.select({ id: insightState.insightId, status: insightState.status }).from(insightState).where(eq(insightState.householdId, householdId));
  return new Map(rows.map((r) => [r.id, r.status]));
}

/** The month's insights split into still-open ones and those the household already handled. */
export async function openInsights(db: Db, f: Filters, month: string) {
  const [all, states] = [await monthInsights(db, f, month), await insightStates(db, f.householdId)];
  return {
    open: all.filter((i) => !states.has(i.id)),
    handled: all.filter((i) => states.has(i.id)).map((i) => ({ insight: i, status: states.get(i.id)! })),
  };
}
