// Manual corrections and re-classification. Manual edits are pinned: nothing automatic
// (re-classification, settlement reconciliation, re-processing) ever overwrites them.
import { and, eq, isNull, ne } from "drizzle-orm";
import { classify, type TransactionKind } from "@ft/core";
import { account, auditLog, categorizationRule, merchant, transaction, type Db } from "@ft/db";
import { ensureCategories, loadClassifierContext } from "./context.js";
import { ImportError } from "./import.js";
import { reconcileSettlements } from "./settlement.js";

export interface CorrectionInput {
  householdId: string;
  transactionId: string;
  actorMemberId?: string;
  kind?: TransactionKind;
  /** category slug; null clears the category */
  category?: string | null;
  memberId?: string | null;
  isShared?: boolean;
  /** "Always do this for this merchant": creates a rule and re-classifies its other transactions. */
  applyToMerchant?: boolean;
}

export interface CorrectionResult {
  ruleId: string | null;
  reclassified: number;
}

export async function correctTransaction(db: Db & { transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T> }, input: CorrectionInput): Promise<CorrectionResult> {
  return db.transaction(async (tx) => {
    const { householdId } = input;
    const [before] = await tx
      .select()
      .from(transaction)
      .where(and(eq(transaction.id, input.transactionId), eq(transaction.householdId, householdId)));
    if (!before) throw new ImportError("not_found", "Transaction not found");
    const maps = await ensureCategories(tx, householdId);
    let categoryId = before.categoryId;
    if (input.category !== undefined) {
      categoryId = input.category === null ? null : (maps.idBySlug.get(input.category) ?? null);
      if (input.category !== null && !categoryId) throw new ImportError("not_found", `Unknown category ${input.category}`);
    }

    const [after] = await tx
      .update(transaction)
      .set({
        kind: input.kind ?? before.kind,
        categoryId,
        memberId: input.memberId !== undefined ? input.memberId : before.memberId,
        isShared: input.isShared ?? before.isShared,
        isManuallyEdited: true,
        classificationSource: "manual",
        classificationConfidence: 1,
        classificationReason: "manual",
        needsReview: false,
        reviewReason: null,
        updatedAt: new Date(),
      })
      .where(eq(transaction.id, before.id))
      .returning();
    await tx.insert(auditLog).values({
      householdId,
      actorMemberId: input.actorMemberId ?? null,
      entity: "transaction",
      entityId: before.id,
      action: "correct",
      before: jsonSafe(before),
      after: jsonSafe(after),
    });

    let ruleId: string | null = null;
    let reclassified = 0;
    if (input.applyToMerchant) {
      const [rule] = await tx
        .insert(categorizationRule)
        .values({
          householdId,
          priority: 100,
          conditions: { merchantKey: before.descriptionNorm },
          actions: { kind: after!.kind, category: categoryId ? maps.slugById.get(categoryId) : undefined },
          createdFromCorrection: true,
        })
        .returning({ id: categorizationRule.id });
      ruleId = rule!.id;
      if (before.merchantId && categoryId) {
        await tx.update(merchant).set({ defaultCategoryId: categoryId, updatedAt: new Date() }).where(eq(merchant.id, before.merchantId));
      }
      reclassified = await reclassify(tx, householdId, { descriptionNorm: before.descriptionNorm });
    }
    return { ruleId, reclassified };
  });
}

/**
 * Re-runs classification over transactions that were not manually edited and are not managed
 * by settlement reconciliation (e.g. after rules change or the dictionary improves).
 */
export async function reclassify(db: Db, householdId: string, filter: { descriptionNorm?: string; merchantId?: string } = {}): Promise<number> {
  const maps = await ensureCategories(db, householdId);
  const ctx = await loadClassifierContext(db, householdId, maps);
  const rows = await db
    .select({ tx: transaction, accountType: account.type })
    .from(transaction)
    .innerJoin(account, eq(account.id, transaction.accountId))
    .where(
      and(
        eq(transaction.householdId, householdId),
        eq(transaction.isManuallyEdited, false),
        isNull(transaction.supersededById),
        ne(transaction.classificationSource, "settlement"),
        filter.descriptionNorm !== undefined ? eq(transaction.descriptionNorm, filter.descriptionNorm) : undefined,
        filter.merchantId !== undefined ? eq(transaction.merchantId, filter.merchantId) : undefined,
      ),
    );
  let changed = 0;
  for (const { tx, accountType } of rows) {
    const c = classify(
      {
        description: tx.descriptionRaw,
        amountMinor: tx.amount,
        accountType: accountType === "bank" ? "bank" : "credit_card",
        accountId: tx.accountId,
        categoryHint: tx.categoryHint ?? undefined,
        typeHint: tx.typeHint ?? undefined,
      },
      ctx,
    );
    const categoryId = c.category ? (maps.idBySlug.get(c.category) ?? null) : null;
    if (c.kind === tx.kind && categoryId === tx.categoryId && c.confidence === tx.classificationConfidence) continue;
    changed++;
    await db
      .update(transaction)
      .set({
        kind: c.kind,
        categoryId,
        classificationSource: c.source,
        classificationConfidence: c.confidence,
        classificationReason: c.reason,
        needsReview: c.needsReview,
        reviewReason: c.needsReview ? "low confidence" : null,
        updatedAt: new Date(),
      })
      .where(eq(transaction.id, tx.id));
  }
  await reconcileSettlements(db, householdId, maps.idBySlug.get("card_unitemized")!);
  return changed;
}

function jsonSafe(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}
