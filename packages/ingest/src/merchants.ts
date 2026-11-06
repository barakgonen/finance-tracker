import { and, eq } from "drizzle-orm";
import { normalizeDescription } from "@ft/core";
import { auditLog, merchant, merchantAlias, transaction, type Db } from "@ft/db";
import { ImportError } from "./import.js";
import { reclassify } from "./corrections.js";
import { ensureCategories } from "./context.js";

/** Finds the canonical merchant for a description via its alias, creating both if new. */
export async function resolveMerchant(db: Db, householdId: string, description: string): Promise<string | null> {
  const { key } = normalizeDescription(description);
  if (!key) return null;
  const [alias] = await db
    .select({ merchantId: merchantAlias.merchantId })
    .from(merchantAlias)
    .where(and(eq(merchantAlias.householdId, householdId), eq(merchantAlias.pattern, key), eq(merchantAlias.match, "exact")));
  if (alias) {
    // follow merges to the surviving merchant
    let id = alias.merchantId;
    for (let hops = 0; hops < 10; hops++) {
      const [m] = await db.select({ mergedIntoId: merchant.mergedIntoId }).from(merchant).where(eq(merchant.id, id));
      if (!m?.mergedIntoId) break;
      id = m.mergedIntoId;
    }
    return id;
  }
  const [created] = await db.insert(merchant).values({ householdId, name: description.trim() }).returning({ id: merchant.id });
  await db.insert(merchantAlias).values({ householdId, merchantId: created!.id, pattern: key, match: "exact", source: "none" });
  return created!.id;
}

// --- merchant management (rename, categorize, merge) ---

async function loadMerchant(db: Db, householdId: string, id: string) {
  const [m] = await db.select().from(merchant).where(and(eq(merchant.id, id), eq(merchant.householdId, householdId)));
  if (!m || m.mergedIntoId) throw new ImportError("not_found", "Merchant not found");
  return m;
}

export async function renameMerchant(db: Db, householdId: string, merchantId: string, name: string, actorMemberId?: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new ImportError("bad_state", "Name is required");
  const m = await loadMerchant(db, householdId, merchantId);
  await db.update(merchant).set({ name: clean, updatedAt: new Date() }).where(eq(merchant.id, m.id));
  await db.insert(auditLog).values({ householdId, actorMemberId: actorMemberId ?? null, entity: "merchant", entityId: m.id, action: "rename", before: { name: m.name }, after: { name: clean } });
}

/**
 * Sets the category for everything bought at a merchant: past transactions are re-classified
 * (manual edits excepted) and future imports follow, since the classifier consults merchant
 * mappings before its own dictionary.
 */
export async function setMerchantCategory(db: Db, householdId: string, merchantId: string, categorySlug: string | null, actorMemberId?: string): Promise<number> {
  const m = await loadMerchant(db, householdId, merchantId);
  const maps = await ensureCategories(db, householdId);
  const categoryId = categorySlug ? (maps.idBySlug.get(categorySlug) ?? null) : null;
  if (categorySlug && !categoryId) throw new ImportError("not_found", `Unknown category ${categorySlug}`);
  await db.update(merchant).set({ defaultCategoryId: categoryId, updatedAt: new Date() }).where(eq(merchant.id, m.id));
  await db.insert(auditLog).values({
    householdId,
    actorMemberId: actorMemberId ?? null,
    entity: "merchant",
    entityId: m.id,
    action: "set_category",
    before: { categoryId: m.defaultCategoryId },
    after: { categoryId },
  });
  return reclassify(db, householdId, { merchantId: m.id });
}

/**
 * Merges `sourceId` into `targetId`: the source's aliases and transactions move to the target, and
 * the source is kept as a pointer (merged_into) so anything referring to it still resolves.
 * Future imports of the source's descriptions land on the target through the moved aliases.
 */
export async function mergeMerchants(db: Db, householdId: string, sourceId: string, targetId: string, actorMemberId?: string): Promise<void> {
  if (sourceId === targetId) throw new ImportError("bad_state", "Can't merge a merchant into itself");
  const source = await loadMerchant(db, householdId, sourceId);
  const target = await loadMerchant(db, householdId, targetId);
  await db.update(merchantAlias).set({ merchantId: target.id, updatedAt: new Date() }).where(eq(merchantAlias.merchantId, source.id));
  const moved = await db
    .update(transaction)
    .set({ merchantId: target.id, updatedAt: new Date() })
    .where(eq(transaction.merchantId, source.id))
    .returning({ id: transaction.id });
  await db.update(merchant).set({ mergedIntoId: target.id, updatedAt: new Date() }).where(eq(merchant.id, source.id));
  await db.insert(auditLog).values({
    householdId,
    actorMemberId: actorMemberId ?? null,
    entity: "merchant",
    entityId: source.id,
    action: "merge",
    before: { name: source.name },
    after: { mergedInto: target.id, targetName: target.name, transactions: moved.length },
  });
  if (target.defaultCategoryId) await reclassify(db, householdId, { merchantId: target.id });
}
