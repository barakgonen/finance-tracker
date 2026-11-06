import { and, eq } from "drizzle-orm";
import { normalizeDescription } from "@ft/core";
import { merchant, merchantAlias, type Db } from "@ft/db";

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
