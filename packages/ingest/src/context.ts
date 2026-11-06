import { and, eq, isNotNull } from "drizzle-orm";
import { SYSTEM_CATEGORIES, type ClassifierContext, type Rule, type RuleActions, type RuleConditions } from "@ft/core";
import { category, categorizationRule, merchant, merchantAlias, transaction, type Db } from "@ft/db";

export interface CategoryMaps {
  idBySlug: Map<string, string>;
  slugById: Map<string, string>;
}

/** Makes sure the household has every system category; returns slug <-> id maps. */
export async function ensureCategories(db: Db, householdId: string): Promise<CategoryMaps> {
  await db
    .insert(category)
    .values(SYSTEM_CATEGORIES.map((c) => ({ householdId, type: c.type, slug: c.slug, nameHe: c.he, nameEn: c.en, isSystem: true })))
    .onConflictDoNothing();
  const rows = await db.select().from(category).where(eq(category.householdId, householdId));
  const idBySlug = new Map(rows.map((r) => [r.slug, r.id]));
  for (const def of SYSTEM_CATEGORIES.filter((c) => c.parent)) {
    const row = rows.find((r) => r.slug === def.slug)!;
    if (!row.parentId) await db.update(category).set({ parentId: idBySlug.get(def.parent!) }).where(eq(category.id, row.id));
  }
  return { idBySlug, slugById: new Map(rows.map((r) => [r.id, r.slug])) };
}

/** The household's rules, merchant mappings and past corrections, in the classifier's terms. */
export async function loadClassifierContext(db: Db, householdId: string, maps: CategoryMaps): Promise<ClassifierContext> {
  const rules = await db
    .select()
    .from(categorizationRule)
    .where(and(eq(categorizationRule.householdId, householdId), eq(categorizationRule.enabled, true)));

  const mapped = await db
    .select({ pattern: merchantAlias.pattern, categoryId: merchant.defaultCategoryId })
    .from(merchantAlias)
    .innerJoin(merchant, eq(merchant.id, merchantAlias.merchantId))
    .where(and(eq(merchantAlias.householdId, householdId), isNotNull(merchant.defaultCategoryId)));

  const corrected = await db
    .select({ key: transaction.descriptionNorm, kind: transaction.kind, categoryId: transaction.categoryId })
    .from(transaction)
    .where(and(eq(transaction.householdId, householdId), eq(transaction.classificationSource, "manual")))
    .limit(5000);

  return {
    rules: rules.map(
      (r): Rule => ({ id: r.id, priority: r.priority, conditions: r.conditions as RuleConditions, actions: r.actions as RuleActions }),
    ),
    merchants: new Map(mapped.map((m) => [m.pattern, { category: maps.slugById.get(m.categoryId!) }])),
    examples: corrected.map((c) => ({ key: c.key, kind: c.kind, category: c.categoryId ? (maps.slugById.get(c.categoryId) ?? null) : null })),
  };
}
