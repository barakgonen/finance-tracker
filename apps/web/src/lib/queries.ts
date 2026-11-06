import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { INCOME_KINDS, SPENDING_KINDS } from "@ft/core";
import { account, category, householdMember, importFile, transaction } from "@ft/db";
import { db } from "./db";

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

export interface MonthSummary {
  incomeMinor: bigint;
  expensesMinor: bigint;
  netMinor: bigint;
  categories: { slug: string; nameHe: string; minor: bigint }[];
  transactionCount: number;
  /** Portions of the totals that come from unreviewed, low-confidence classifications. */
  unreviewed: { count: number; incomeMinor: bigint; expensesMinor: bigint };
}

/**
 * Income and spending for a month. Spending is money out of spending kinds net of refunds;
 * transfers, card settlements and savings are excluded. `memberId` narrows to one member.
 */
export async function monthSummary(householdId: string, month: string, memberId?: string): Promise<MonthSummary> {
  const { from, to } = monthRange(month);
  const kinds = [...SPENDING_KINDS, ...INCOME_KINDS];
  const rows = await db()
    .select({
      kind: transaction.kind,
      slug: category.slug,
      nameHe: category.nameHe,
      needsReview: transaction.needsReview,
      total: sql<string>`sum(${transaction.amount})`,
      count: sql<number>`count(*)::int`,
    })
    .from(transaction)
    .leftJoin(category, eq(category.id, transaction.categoryId))
    .where(
      and(
        eq(transaction.householdId, householdId),
        isNull(transaction.supersededById),
        eq(transaction.status, "posted"),
        gte(transaction.purchaseDate, from),
        lt(transaction.purchaseDate, to),
        inArray(transaction.kind, kinds),
        memberId ? eq(transaction.memberId, memberId) : undefined,
      ),
    )
    .groupBy(transaction.kind, category.slug, category.nameHe, transaction.needsReview);

  let income = 0n;
  let spending = 0n;
  const unreviewed = { count: 0, incomeMinor: 0n, expensesMinor: 0n };
  const byCategory = new Map<string, { slug: string; nameHe: string; minor: bigint }>();
  for (const r of rows) {
    const total = BigInt(r.total);
    if (r.needsReview) unreviewed.count += r.count;
    if (INCOME_KINDS.has(r.kind)) {
      income += total;
      if (r.needsReview) unreviewed.incomeMinor += total;
      continue;
    }
    spending -= total;
    if (r.needsReview) unreviewed.expensesMinor -= total;
    const slug = r.slug ?? "uncategorized";
    const entry = byCategory.get(slug) ?? { slug, nameHe: r.nameHe ?? "ללא קטגוריה", minor: 0n };
    entry.minor -= total;
    byCategory.set(slug, entry);
  }
  return {
    incomeMinor: income,
    expensesMinor: spending,
    netMinor: income - spending,
    categories: [...byCategory.values()].filter((c) => c.minor > 0n).sort((a, b) => (b.minor > a.minor ? 1 : -1)),
    transactionCount: rows.reduce((a, r) => a + r.count, 0),
    unreviewed,
  };
}

export async function reviewCount(householdId: string): Promise<number> {
  const [r] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(transaction)
    .where(and(eq(transaction.householdId, householdId), eq(transaction.needsReview, true), isNull(transaction.supersededById)));
  return r?.n ?? 0;
}

export async function reviewItems(householdId: string, limit = 50) {
  return db()
    .select({
      tx: transaction,
      accountName: account.name,
      accountType: account.type,
      categorySlug: category.slug,
    })
    .from(transaction)
    .innerJoin(account, eq(account.id, transaction.accountId))
    .leftJoin(category, eq(category.id, transaction.categoryId))
    .where(and(eq(transaction.householdId, householdId), eq(transaction.needsReview, true), isNull(transaction.supersededById)))
    .orderBy(desc(transaction.purchaseDate))
    .limit(limit);
}

export async function categories(householdId: string) {
  return db().select().from(category).where(eq(category.householdId, householdId)).orderBy(asc(category.type), asc(category.nameHe));
}

export async function members(householdId: string) {
  return db().select().from(householdMember).where(eq(householdMember.householdId, householdId)).orderBy(asc(householdMember.createdAt));
}

export async function accounts(householdId: string) {
  return db().select().from(account).where(eq(account.householdId, householdId)).orderBy(asc(account.type), asc(account.createdAt));
}

export async function imports(householdId: string, limit = 30) {
  return db()
    .select({
      id: importFile.id,
      fileName: importFile.fileName,
      status: importFile.status,
      institution: importFile.institution,
      stats: importFile.stats,
      createdAt: importFile.createdAt,
      accountName: account.name,
    })
    .from(importFile)
    .leftJoin(account, eq(account.id, importFile.accountId))
    .where(eq(importFile.householdId, householdId))
    .orderBy(desc(importFile.createdAt))
    .limit(limit);
}

/** Most recent month that has transactions, so a fresh install doesn't open on an empty month. */
export async function latestMonth(householdId: string): Promise<string> {
  const [r] = await db()
    .select({ d: sql<string | null>`max(${transaction.purchaseDate})` })
    .from(transaction)
    .where(eq(transaction.householdId, householdId));
  return (r?.d ?? new Date().toISOString()).slice(0, 7);
}
