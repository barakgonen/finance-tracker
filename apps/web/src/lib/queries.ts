import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { account, category, householdMember, importFile, transaction, type Db } from "@ft/db";

// Every query takes the request's household-scoped transaction (see scope() in ./db): with
// row-level security, a query outside it would see nothing.

export async function reviewCount(db: Db, householdId: string, viewerMemberId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transaction)
    .innerJoin(account, eq(account.id, transaction.accountId))
    .where(
      and(
        eq(transaction.householdId, householdId),
        eq(transaction.needsReview, true),
        isNull(transaction.supersededById),
        sql`(${account.visibility} <> 'private' or ${account.ownerMemberId} = ${viewerMemberId})`,
      ),
    );
  return r?.n ?? 0;
}

/** Whether the viewer may see an account's individual transactions. */
export async function canSeeDetails(db: Db, householdId: string, accountId: string, viewerMemberId: string): Promise<boolean> {
  const [a] = await db.select({ visibility: account.visibility, owner: account.ownerMemberId }).from(account).where(and(eq(account.id, accountId), eq(account.householdId, householdId)));
  return !!a && (a.visibility !== "private" || a.owner === viewerMemberId);
}

/** Review items the viewer may see (other members' private accounts are left out). */
export async function reviewItems(db: Db, householdId: string, viewerMemberId: string, limit = 50) {
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
    .where(
      and(
        eq(transaction.householdId, householdId),
        eq(transaction.needsReview, true),
        isNull(transaction.supersededById),
        sql`(${account.visibility} <> 'private' or ${account.ownerMemberId} = ${viewerMemberId})`,
      ),
    )
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
