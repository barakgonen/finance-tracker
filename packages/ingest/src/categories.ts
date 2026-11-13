// Household categories beyond the built-in list, and splitting one transaction across categories.
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { INCOME_KINDS, SPENDING_KINDS } from "@ft/core";
import { auditLog, budget, categorizationRule, category, goal, householdMember, merchant, transaction, transactionSplit, type Db } from "@ft/db";
import { ImportError } from "./import.js";

type TxDb = Db & { transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T> };

const audit = (db: Db, householdId: string, actor: string | undefined, entity: string, entityId: string, action: string, after?: unknown) =>
  db.insert(auditLog).values({ householdId, actorMemberId: actor ?? null, entity, entityId, action, after: after ?? null });

async function checkName(db: Db, householdId: string, type: "expense" | "income", name: string, except?: string): Promise<string> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new ImportError("bad_state", "Name is required");
  if (clean.length > 40) throw new ImportError("bad_state", "The name is too long (40 characters at most)");
  const [taken] = await db
    .select({ id: category.id })
    .from(category)
    .where(
      and(
        eq(category.householdId, householdId),
        eq(category.type, type),
        sql`(lower(${category.nameHe}) = lower(${clean}) or lower(${category.nameEn}) = lower(${clean}))`,
        except ? ne(category.id, except) : undefined,
      ),
    );
  if (taken) throw new ImportError("bad_state", "A category with this name already exists");
  return clean;
}

async function customCategory(db: Db, householdId: string, id: string) {
  const [c] = await db.select().from(category).where(and(eq(category.householdId, householdId), eq(category.id, id)));
  if (!c) throw new ImportError("not_found", "Category not found");
  if (c.isSystem) throw new ImportError("bad_state", "Built-in categories can't be changed");
  return c;
}

/** A category of the household's own. One name serves both languages unless an English one is given. */
export async function createCategory(
  db: Db,
  input: { householdId: string; type: "expense" | "income"; name: string; nameEn?: string; actorMemberId?: string },
) {
  const name = await checkName(db, input.householdId, input.type, input.name);
  const nameEn = input.nameEn?.trim() ? await checkName(db, input.householdId, input.type, input.nameEn) : name;
  const [row] = await db
    .insert(category)
    .values({ householdId: input.householdId, type: input.type, slug: `c_${randomBytes(5).toString("hex")}`, nameHe: name, nameEn, isSystem: false })
    .returning();
  await audit(db, input.householdId, input.actorMemberId, "category", row!.id, "create", { name, nameEn, type: input.type });
  return row!;
}

export async function renameCategory(db: Db, input: { householdId: string; categoryId: string; name: string; nameEn?: string; actorMemberId?: string }) {
  const c = await customCategory(db, input.householdId, input.categoryId);
  const name = await checkName(db, input.householdId, c.type, input.name, c.id);
  const nameEn = input.nameEn?.trim() ? await checkName(db, input.householdId, c.type, input.nameEn, c.id) : name;
  await db.update(category).set({ nameHe: name, nameEn, updatedAt: new Date() }).where(eq(category.id, c.id));
  await audit(db, input.householdId, input.actorMemberId, "category", c.id, "rename", { from: c.nameHe, to: name, nameEn });
}

/**
 * Deletes a category of the household's own. Everything that used it moves to `moveTo` (same
 * type), or, without one, becomes uncategorized; budgets for it are then removed and goals archived.
 */
export async function deleteCategory(db: TxDb, input: { householdId: string; categoryId: string; moveTo: string | null; actorMemberId?: string }) {
  return db.transaction(async (tx) => {
    const { householdId } = input;
    const c = await customCategory(tx, householdId, input.categoryId);
    let target: typeof c | null = null;
    if (input.moveTo) {
      target = (await tx.select().from(category).where(and(eq(category.householdId, householdId), eq(category.slug, input.moveTo))))[0] ?? null;
      if (!target || target.id === c.id || target.type !== c.type) throw new ImportError("bad_state", "Choose another category of the same type");
    }
    const to = target?.id ?? null;
    const moved = await tx.update(transaction).set({ categoryId: to, updatedAt: new Date() }).where(eq(transaction.categoryId, c.id)).returning({ id: transaction.id });
    await tx.update(transactionSplit).set({ categoryId: to, updatedAt: new Date() }).where(eq(transactionSplit.categoryId, c.id));
    await tx.update(merchant).set({ defaultCategoryId: to, updatedAt: new Date() }).where(eq(merchant.defaultCategoryId, c.id));
    await tx.update(category).set({ parentId: null }).where(eq(category.parentId, c.id));
    // rules name categories by slug
    await tx
      .update(categorizationRule)
      .set({
        actions: target ? sql`jsonb_set(${categorizationRule.actions}, '{category}', to_jsonb(${target.slug}::text))` : sql`${categorizationRule.actions} - 'category'`,
        updatedAt: new Date(),
      })
      .where(and(eq(categorizationRule.householdId, householdId), sql`${categorizationRule.actions}->>'category' = ${c.slug}`));
    // a budget moves unless the target already has one for the same scope
    for (const b of await tx.select().from(budget).where(eq(budget.categoryId, c.id))) {
      const [clash] = target
        ? await tx.select({ id: budget.id }).from(budget).where(and(eq(budget.categoryId, target.id), b.memberId ? eq(budget.memberId, b.memberId) : isNull(budget.memberId)))
        : [];
      if (target && !clash) await tx.update(budget).set({ categoryId: target.id, updatedAt: new Date() }).where(eq(budget.id, b.id));
      else await tx.delete(budget).where(eq(budget.id, b.id));
    }
    await tx.update(goal).set(target ? { categoryId: target.id, updatedAt: new Date() } : { categoryId: null, status: "archived", updatedAt: new Date() }).where(eq(goal.categoryId, c.id));
    await tx.delete(category).where(eq(category.id, c.id));
    await audit(tx, householdId, input.actorMemberId, "category", c.id, "delete", { name: c.nameHe, movedTo: target?.slug ?? null, transactions: moved.length });
    return { moved: moved.length };
  });
}

export interface SplitPart {
  /** positive: the part's share of the transaction, in agorot */
  amountMinor: bigint;
  /** category slug, or null for uncategorized */
  category: string | null;
  /** whose part it is: a member id, null for shared; omitted = the transaction's owner */
  member?: string | null;
}

/**
 * Splits a transaction across categories and/or people (an empty list removes the split). The
 * parts must add up to the transaction exactly; category figures then count each part in its own
 * category, and each member's view counts that member's parts. The transaction keeps the largest
 * part's category as its label.
 */
export async function setSplits(db: TxDb, input: { householdId: string; transactionId: string; parts: SplitPart[]; actorMemberId?: string }) {
  return db.transaction(async (tx) => {
    const { householdId } = input;
    const [t] = await tx.select().from(transaction).where(and(eq(transaction.householdId, householdId), eq(transaction.id, input.transactionId)));
    if (!t) throw new ImportError("not_found", "Transaction not found");
    const spending = SPENDING_KINDS.has(t.kind);
    if (!spending && !INCOME_KINDS.has(t.kind)) throw new ImportError("bad_state", "Only spending or income can be split");

    if (input.parts.length === 0) {
      await tx.delete(transactionSplit).where(eq(transactionSplit.transactionId, t.id));
      await audit(tx, householdId, input.actorMemberId, "transaction", t.id, "unsplit");
      return;
    }
    if (input.parts.length < 2) throw new ImportError("bad_state", "A split needs at least two parts");
    if (input.parts.some((p) => p.amountMinor <= 0n)) throw new ImportError("bad_state", "Every part needs a positive amount");
    const abs = t.amount < 0n ? -t.amount : t.amount;
    if (input.parts.reduce((a, p) => a + p.amountMinor, 0n) !== abs) throw new ImportError("bad_state", "The parts must add up to the transaction amount");

    const slugs = [...new Set(input.parts.map((p) => p.category).filter((s): s is string => s !== null))];
    const cats = slugs.length ? await tx.select().from(category).where(and(eq(category.householdId, householdId), inArray(category.slug, slugs))) : [];
    const want = spending ? "expense" : "income";
    if (cats.length !== slugs.length || cats.some((c) => c.type !== want)) throw new ImportError("bad_state", "Choose categories that fit the transaction");
    const idOf = new Map(cats.map((c) => [c.slug, c.id]));
    const memberIds = [...new Set(input.parts.map((p) => p.member).filter((m): m is string => typeof m === "string"))];
    if (memberIds.length) {
      const found = await tx.select({ id: householdMember.id }).from(householdMember).where(and(eq(householdMember.householdId, householdId), inArray(householdMember.id, memberIds)));
      if (found.length !== memberIds.length) throw new ImportError("not_found", "Member not found");
    }
    const ownerOf = (p: SplitPart) => (p.member === undefined ? (t.isShared ? null : t.memberId) : p.member);
    const sign = t.amount < 0n ? -1n : 1n;

    await tx.delete(transactionSplit).where(eq(transactionSplit.transactionId, t.id));
    await tx.insert(transactionSplit).values(
      input.parts.map((p) => ({ householdId, transactionId: t.id, amount: p.amountMinor * sign, categoryId: p.category ? idOf.get(p.category)! : null, memberId: ownerOf(p) })),
    );
    const largest = [...input.parts].sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : b.amountMinor < a.amountMinor ? -1 : 0))[0]!;
    await tx
      .update(transaction)
      .set({
        categoryId: largest.category ? idOf.get(largest.category)! : null,
        // pinned like any manual edit: re-classification and re-processing leave it alone
        isManuallyEdited: true,
        classificationSource: "manual",
        classificationConfidence: 1,
        classificationReason: "manual",
        needsReview: false,
        reviewReason: null,
        updatedAt: new Date(),
      })
      .where(eq(transaction.id, t.id));
    await audit(tx, householdId, input.actorMemberId, "transaction", t.id, "split", input.parts.map((p) => ({ amount: p.amountMinor.toString(), category: p.category, member: ownerOf(p) })));
  });
}

/** The parts of split transactions, by transaction id. */
export async function splitsOf(db: Db, householdId: string, transactionIds: string[]) {
  const out = new Map<string, { amountMinor: bigint; categorySlug: string | null; categoryName: string | null; memberId: string | null }[]>();
  if (!transactionIds.length) return out;
  const rows = await db
    .select({ transactionId: transactionSplit.transactionId, amount: transactionSplit.amount, slug: category.slug, name: category.nameHe, memberId: transactionSplit.memberId })
    .from(transactionSplit)
    .leftJoin(category, eq(category.id, transactionSplit.categoryId))
    .where(and(eq(transactionSplit.householdId, householdId), inArray(transactionSplit.transactionId, transactionIds)))
    .orderBy(sql`abs(${transactionSplit.amount}) desc`);
  for (const r of rows) out.set(r.transactionId, [...(out.get(r.transactionId) ?? []), { amountMinor: r.amount, categorySlug: r.slug, categoryName: r.name, memberId: r.memberId }]);
  return out;
}
