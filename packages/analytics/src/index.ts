// Household financial analytics. Every function takes a row-level-security scoped transaction
// and the same Filters, and all of them build on one definition of "spending" and "income"
// (spendingWhere / incomeWhere), so a drill-down list always adds up to the figure it came from.
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { INCOME_KINDS, SPENDING_KINDS, type TransactionKind } from "@ft/core";
import { account, category, merchant, transaction, transactionSplit, type Db } from "@ft/db";
import { monthRange, monthsBetween, shiftMonth } from "./months.js";

export * from "./months.js";

export interface Filters {
  householdId: string;
  /** narrows to one member's transactions (the individual view) */
  memberId?: string;
  /**
   * The member looking. Other members' private accounts then count in totals but their individual
   * transactions and merchants are left out. Unset only for internal computations.
   */
  viewerMemberId?: string;
}

/**
 * Excludes transactions of other members' private accounts. Used by everything that shows
 * individual transactions or merchant names; totals and category sums keep counting them.
 */
export function detailsVisible(f: Filters): SQL | undefined {
  if (!f.viewerMemberId) return undefined;
  return sql`${transaction.accountId} not in (select ${account.id} from ${account} where ${account.householdId} = ${f.householdId} and ${account.visibility} = 'private' and ${account.ownerMemberId} is distinct from ${f.viewerMemberId})`;
}

const SPENDING = [...SPENDING_KINDS] as TransactionKind[];
const INCOME = [...INCOME_KINDS] as TransactionKind[];

// A split transaction's parts can each have a category and an owner. Figures read "lines": the
// transaction itself, or (joined with transaction_split) each of its parts, which add up to it.
// Every query joins the parts with linesOn(): they are matched only when the figure depends on
// them (a member's view, or a breakdown by category); otherwise the join matches nothing and
// each transaction is one line, as if it weren't split.
export const lineCategoryId = sql`(case when ${transactionSplit.id} is null then ${transaction.categoryId} else ${transactionSplit.categoryId} end)`;
export const lineAmount = sql<bigint>`(case when ${transactionSplit.id} is null then ${transaction.amount} else ${transactionSplit.amount} end)`;
export const lineMemberId = sql`(case when ${transactionSplit.id} is null then ${transaction.memberId} else ${transactionSplit.memberId} end)`;
export const splitJoin = eq(transactionSplit.transactionId, transaction.id);
export const linesOn = (f: Filters, byCategory = false) => (f.memberId || byCategory ? splitJoin : sql`false`);

/**
 * Rows that count at all: this household, posted, not replaced by a later version; in a member's
 * view, that member's lines. Queries using it join transaction_split with linesOn(f).
 */
function base(f: Filters, from: string, to: string): SQL {
  return and(
    eq(transaction.householdId, f.householdId),
    isNull(transaction.supersededById),
    eq(transaction.status, "posted"),
    gte(transaction.purchaseDate, from),
    lt(transaction.purchaseDate, to),
    f.memberId ? sql`${lineMemberId} = ${f.memberId}` : undefined,
  )!;
}

// Income is money coming in. Classification never makes outgoing money income, but should a row
// say so anyway (an old manual edit, say), the money still left: it counts as spending.
const incomeIn = () => and(inArray(transaction.kind, INCOME), gt(transaction.amount, 0n))!;
const incomeOut = () => and(inArray(transaction.kind, INCOME), lt(transaction.amount, 0n))!;
export const spendingWhere = (f: Filters, from: string, to: string) => and(base(f, from, to), or(inArray(transaction.kind, SPENDING), incomeOut()))!;
export const incomeWhere = (f: Filters, from: string, to: string) => and(base(f, from, to), incomeIn())!;

const minor = (v: string | null | undefined) => BigInt(v ?? "0");
/** Spending rows are negative; their sum negated is the amount spent (refunds reduce it). */
const spentSum = sql<string>`coalesce(-sum(${lineAmount}), 0)`;
const amountSum = sql<string>`coalesce(sum(${lineAmount}), 0)`;
const unreviewedSum = sql<string>`coalesce(sum(${lineAmount}) filter (where ${transaction.needsReview}), 0)`;
/** transactions, not lines (a transaction split in two is still one purchase) */
const txCount = sql<number>`count(distinct ${transaction.id})::int`;
const monthOf = sql<string>`to_char(${transaction.purchaseDate}, 'YYYY-MM')`;

// --- month totals ---

export interface MonthTotals {
  month: string;
  incomeMinor: bigint;
  expensesMinor: bigint;
  netMinor: bigint;
  /** how much of each total comes from unreviewed (guessed) classifications */
  unreviewedIncomeMinor: bigint;
  unreviewedExpensesMinor: bigint;
  unreviewedCount: number;
  transactionCount: number;
}

/** Income, spending and net for each month in [first, last], zero-filled. */
export async function monthlySeries(db: Db, f: Filters, first: string, last: string): Promise<MonthTotals[]> {
  const { from } = monthRange(first);
  const { to } = monthRange(last);
  const rows = await db
    .select({
      month: monthOf,
      isIncome: sql<boolean>`${incomeIn()}`,
      total: amountSum,
      unreviewed: unreviewedSum,
      unreviewedCount: sql<number>`(count(distinct ${transaction.id}) filter (where ${transaction.needsReview}))::int`,
      count: txCount,
    })
    .from(transaction)
    .leftJoin(transactionSplit, linesOn(f))
    .where(and(base(f, from, to), inArray(transaction.kind, [...SPENDING, ...INCOME])))
    .groupBy(monthOf, sql`2`); // 2 = isIncome

  const byMonth = new Map(
    monthsBetween(first, last).map((m) => [
      m,
      { month: m, incomeMinor: 0n, expensesMinor: 0n, netMinor: 0n, unreviewedIncomeMinor: 0n, unreviewedExpensesMinor: 0n, unreviewedCount: 0, transactionCount: 0 },
    ]),
  );
  for (const r of rows) {
    const t = byMonth.get(r.month);
    if (!t) continue;
    t.transactionCount += r.count;
    t.unreviewedCount += r.unreviewedCount;
    if (r.isIncome) {
      t.incomeMinor += minor(r.total);
      t.unreviewedIncomeMinor += minor(r.unreviewed);
    } else {
      t.expensesMinor -= minor(r.total);
      t.unreviewedExpensesMinor -= minor(r.unreviewed);
    }
  }
  for (const t of byMonth.values()) t.netMinor = t.incomeMinor - t.expensesMinor;
  return [...byMonth.values()];
}

export async function monthTotals(db: Db, f: Filters, month: string): Promise<MonthTotals> {
  return (await monthlySeries(db, f, month, month))[0]!;
}

// --- categories ---

export interface CategoryRow {
  slug: string;
  nameHe: string;
  nameEn: string;
  minor: bigint;
  prevMinor: bigint;
  /** average over the preceding three months that have data; null without history */
  avg3Minor: bigint | null;
  /** share of the month's total for this side (0..1) */
  share: number;
  count: number;
}

export const UNCATEGORIZED = "uncategorized";

async function categoryTotals(db: Db, where: SQL, sign: 1n | -1n) {
  const rows = await db
    .select({
      slug: category.slug,
      nameHe: category.nameHe,
      nameEn: category.nameEn,
      month: monthOf,
      total: sql<string>`coalesce(sum(${lineAmount}), 0)`,
      count: txCount,
    })
    .from(transaction)
    .leftJoin(transactionSplit, splitJoin) // always by line: a breakdown by category
    .leftJoin(category, eq(category.id, lineCategoryId))
    .where(where)
    .groupBy(category.slug, category.nameHe, category.nameEn, monthOf);
  return rows.map((r) => ({ ...r, slug: r.slug ?? UNCATEGORIZED, minor: minor(r.total) * sign }));
}

/**
 * Spending (or income) by category for a month, with last month and the average of the three
 * months before it for comparison.
 */
export async function categoryBreakdown(db: Db, f: Filters, month: string, side: "spending" | "income" = "spending"): Promise<CategoryRow[]> {
  const first = shiftMonth(month, -3);
  const { from } = monthRange(first);
  const { to } = monthRange(month);
  const where = side === "spending" ? spendingWhere(f, from, to) : incomeWhere(f, from, to);
  const rows = await categoryTotals(db, where, side === "spending" ? -1n : 1n);

  const history = monthsBetween(first, shiftMonth(month, -1));
  const monthsWithData = new Set(rows.filter((r) => r.month !== month).map((r) => r.month));
  const historyMonths = history.filter((m) => monthsWithData.has(m)).length;
  const prev = shiftMonth(month, -1);

  const out = new Map<string, CategoryRow>();
  for (const r of rows) {
    const c =
      out.get(r.slug) ??
      ({ slug: r.slug, nameHe: r.nameHe ?? "ללא קטגוריה", nameEn: r.nameEn ?? "Uncategorized", minor: 0n, prevMinor: 0n, avg3Minor: 0n, share: 0, count: 0 } as CategoryRow);
    if (r.month === month) {
      c.minor += r.minor;
      c.count += r.count;
    } else {
      c.avg3Minor = (c.avg3Minor ?? 0n) + r.minor;
      if (r.month === prev) c.prevMinor += r.minor;
    }
    out.set(r.slug, c);
  }
  const total = [...out.values()].reduce((a, c) => a + (c.minor > 0n ? c.minor : 0n), 0n);
  return [...out.values()]
    .map((c) => ({
      ...c,
      avg3Minor: historyMonths > 0 ? (c.avg3Minor ?? 0n) / BigInt(historyMonths) : null,
      share: total > 0n && c.minor > 0n ? Number(c.minor) / Number(total) : 0,
    }))
    .filter((c) => c.minor !== 0n || c.prevMinor !== 0n)
    .sort((a, b) => (b.minor > a.minor ? 1 : b.minor < a.minor ? -1 : 0));
}

// --- merchants ---

export interface MerchantRow {
  merchantId: string;
  name: string;
  minor: bigint;
  count: number;
  avgMinor: bigint;
  prevMinor: bigint;
}

/** Top merchants by spending in a month, with last month's spending at each. */
export async function merchantBreakdown(db: Db, f: Filters, month: string, limit = 10): Promise<MerchantRow[]> {
  const prev = shiftMonth(month, -1);
  const rows = await db
    .select({ merchantId: merchant.id, name: merchant.name, month: monthOf, total: spentSum, count: txCount })
    .from(transaction)
    .leftJoin(transactionSplit, linesOn(f))
    .innerJoin(merchant, eq(merchant.id, transaction.merchantId))
    .where(and(spendingWhere(f, monthRange(prev).from, monthRange(month).to), detailsVisible(f)))
    .groupBy(merchant.id, merchant.name, monthOf);
  const out = new Map<string, MerchantRow>();
  for (const r of rows) {
    const m = out.get(r.merchantId) ?? { merchantId: r.merchantId, name: r.name, minor: 0n, count: 0, avgMinor: 0n, prevMinor: 0n };
    if (r.month === month) {
      m.minor += minor(r.total);
      m.count += r.count;
    } else m.prevMinor += minor(r.total);
    out.set(r.merchantId, m);
  }
  return [...out.values()]
    .filter((m) => m.minor > 0n)
    .map((m) => ({ ...m, avgMinor: m.count ? m.minor / BigInt(m.count) : 0n }))
    .sort((a, b) => (b.minor > a.minor ? 1 : b.minor < a.minor ? -1 : 0))
    .slice(0, limit);
}

// --- time ---

/** Spending per calendar day of a month (zero-filled). */
export async function dailySpending(db: Db, f: Filters, month: string): Promise<{ date: string; minor: bigint }[]> {
  const { from, to } = monthRange(month);
  const rows = await db
    .select({ date: sql<string>`${transaction.purchaseDate}::text`, total: spentSum })
    .from(transaction)
    .leftJoin(transactionSplit, linesOn(f))
    .where(spendingWhere(f, from, to))
    .groupBy(transaction.purchaseDate);
  const byDay = new Map(rows.map((r) => [r.date, minor(r.total)]));
  const days: { date: string; minor: bigint }[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) < to; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, minor: byDay.get(iso) ?? 0n });
  }
  return days;
}

// --- cash flow ---

export interface CashFlowMonth {
  month: string;
  incomeMinor: bigint;
  spendingMinor: bigint;
  /** net money moved into savings/investments (positive = saved) */
  savedMinor: bigint;
  /** net of transfers between people and the household's own accounts */
  transfersMinor: bigint;
  /** card bills paid from the bank: shown for completeness, never counted as spending */
  cardBillsMinor: bigint;
  netMinor: bigint;
}

/**
 * Money in and out by month, grouped by what it was: income, spending, savings, transfers and
 * card bill payments (which are excluded from spending since the card rows already count).
 */
export async function cashFlow(db: Db, f: Filters, first: string, last: string): Promise<CashFlowMonth[]> {
  const { from } = monthRange(first);
  const { to } = monthRange(last);
  const rows = await db
    .select({ month: monthOf, kind: transaction.kind, isIncome: sql<boolean>`${incomeIn()}`, total: amountSum })
    .from(transaction)
    .leftJoin(transactionSplit, linesOn(f))
    .where(base(f, from, to))
    .groupBy(monthOf, transaction.kind, sql`3`); // 3 = isIncome
  const out = new Map(
    monthsBetween(first, last).map((m) => [
      m,
      { month: m, incomeMinor: 0n, spendingMinor: 0n, savedMinor: 0n, transfersMinor: 0n, cardBillsMinor: 0n, netMinor: 0n },
    ]),
  );
  for (const r of rows) {
    const c = out.get(r.month);
    if (!c) continue;
    const total = minor(r.total);
    if (r.isIncome) c.incomeMinor += total;
    else if (SPENDING_KINDS.has(r.kind) || INCOME_KINDS.has(r.kind)) c.spendingMinor -= total;
    else if (r.kind === "savings_investment") c.savedMinor -= total;
    else if (r.kind === "card_settlement") c.cardBillsMinor -= total;
    else c.transfersMinor += total; // internal_transfer, p2p_transfer
  }
  for (const c of out.values()) c.netMinor = c.incomeMinor - c.spendingMinor;
  return [...out.values()];
}

/** Coefficient of variation of monthly income (0 = perfectly stable); null with < 3 months of income. */
export function incomeStability(monthlyIncome: bigint[]): number | null {
  const values = monthlyIncome.filter((v) => v > 0n).map(Number);
  if (values.length < 3) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  return sd / mean;
}

// --- transactions (drill-down) ---

export interface TransactionQuery {
  from: string;
  to: string;
  side?: "spending" | "income" | "all";
  /** category slug, or UNCATEGORIZED */
  category?: string;
  merchantId?: string;
  accountId?: string;
  /** the rows itemized on one card bill, whatever their dates (from/to are then ignored) */
  billId?: string;
  /** one row per split part (as with a category filter), e.g. for an export */
  lines?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * A page of transactions plus the count and sum of *all* matching rows. Filtered by category, a
 * split transaction appears with just its part in that category (`isSplitPart`), so the list adds
 * up to the category's total.
 */
export async function listTransactions(db: Db, f: Filters, q: TransactionQuery) {
  const side = q.side ?? "all";
  if (q.billId) q = { ...q, from: "0001-01-01", to: "9999-12-31" };
  // a member's view shows that member's part of a transaction split between people
  const byLine = q.category !== undefined || q.lines === true || f.memberId !== undefined;
  const categoryOf = byLine ? lineCategoryId : transaction.categoryId;
  const amountOf = byLine ? lineAmount : transaction.amount;
  const where = and(
    side === "spending" ? spendingWhere(f, q.from, q.to) : side === "income" ? incomeWhere(f, q.from, q.to) : base(f, q.from, q.to),
    detailsVisible(f),
    q.category === UNCATEGORIZED ? sql`${categoryOf} is null` : q.category ? eq(category.slug, q.category) : undefined,
    q.merchantId ? eq(transaction.merchantId, q.merchantId) : undefined,
    q.accountId ? eq(transaction.accountId, q.accountId) : undefined,
    q.billId ? eq(transaction.cardBillId, q.billId) : undefined,
    q.search ? or(ilike(transaction.descriptionRaw, `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)) : undefined,
  );
  const [summary] = await db
    .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${amountOf}), 0)` })
    .from(transaction)
    // without a category filter the split join matches nothing, so every transaction is one row
    .leftJoin(transactionSplit, byLine ? splitJoin : sql`false`)
    .leftJoin(category, eq(category.id, categoryOf))
    .where(where);
  const rows = await db
    .select({
      id: transaction.id,
      purchaseDate: transaction.purchaseDate,
      description: transaction.descriptionRaw,
      amount: sql<bigint>`${amountOf}`.mapWith(BigInt),
      originalAmount: transaction.originalAmount,
      originalCurrency: transaction.originalCurrency,
      kind: transaction.kind,
      needsReview: transaction.needsReview,
      installmentNo: transaction.installmentNo,
      installmentTotal: transaction.installmentTotal,
      categorySlug: category.slug,
      categoryNameHe: category.nameHe,
      accountName: account.name,
      merchantId: transaction.merchantId,
      cardBillId: transaction.cardBillId,
      // a split part's own owner (a part without one is shared)
      memberId: sql<string | null>`${lineMemberId}`,
      isShared: sql<boolean>`(case when ${transactionSplit.id} is null then ${transaction.isShared} else ${transactionSplit.memberId} is null end)`,
      postingDate: transaction.postingDate,
      isSplitPart: byLine ? sql<boolean>`${transactionSplit.id} is not null` : sql<boolean>`false`,
    })
    .from(transaction)
    .leftJoin(transactionSplit, byLine ? splitJoin : sql`false`)
    .leftJoin(category, eq(category.id, categoryOf))
    .innerJoin(account, eq(account.id, transaction.accountId))
    .where(where)
    // split parts of one transaction share its id: their own id keeps paging stable
    .orderBy(desc(transaction.purchaseDate), asc(transaction.id), sql`${transactionSplit.id} asc nulls first`)
    .limit(q.limit ?? 100)
    .offset(q.offset ?? 0);
  return { rows, count: summary?.count ?? 0, totalMinor: minor(summary?.total) };
}

/** The month's largest income and spending transactions by absolute amount. */
export async function largestTransactions(db: Db, f: Filters, month: string, limit = 5) {
  const { from, to } = monthRange(month);
  return db
    .select({ id: transaction.id, purchaseDate: transaction.purchaseDate, description: transaction.descriptionRaw, amount: sql<bigint>`${lineAmount}`.mapWith(BigInt), kind: transaction.kind, needsReview: transaction.needsReview })
    .from(transaction)
    .leftJoin(transactionSplit, linesOn(f))
    .where(and(base(f, from, to), inArray(transaction.kind, [...SPENDING, ...INCOME]), detailsVisible(f)))
    .orderBy(desc(sql`abs(${lineAmount})`))
    .limit(limit);
}

/** Latest month that has any transaction (so a fresh view opens on data, not an empty month). */
export async function latestMonth(db: Db, householdId: string): Promise<string | null> {
  const [r] = await db
    .select({ d: sql<string | null>`max(${transaction.purchaseDate})::text` })
    .from(transaction)
    .where(eq(transaction.householdId, householdId));
  return r?.d ? r.d.slice(0, 7) : null;
}
export * from "./intelligence.js";
export * from "./health.js";
export * from "./planning.js";
export * from "./bills.js";
