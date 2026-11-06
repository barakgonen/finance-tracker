import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { account, category, householdMember, importFile, transaction, type Db } from "@ft/db";

// Every query takes the request's household-scoped transaction (see scope() in ./db): with
// row-level security, a query outside it would see nothing.

export async function reviewCount(db: Db, householdId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transaction)
    .where(and(eq(transaction.householdId, householdId), eq(transaction.needsReview, true), isNull(transaction.supersededById)));
  return r?.n ?? 0;
}

export async function reviewItems(db: Db, householdId: string, limit = 50) {
  return db
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

export async function categories(db: Db, householdId: string) {
  return db.select().from(category).where(eq(category.householdId, householdId)).orderBy(asc(category.type), asc(category.nameHe));
}

export async function members(db: Db, householdId: string) {
  return db.select().from(householdMember).where(eq(householdMember.householdId, householdId)).orderBy(asc(householdMember.createdAt));
}

export async function accounts(db: Db, householdId: string) {
  return db.select().from(account).where(eq(account.householdId, householdId)).orderBy(asc(account.type), asc(account.createdAt));
}

export async function imports(db: Db, householdId: string, limit = 30) {
  return db
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
