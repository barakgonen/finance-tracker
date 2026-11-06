// Household and account setup used by onboarding and settings (and tests).
import { and, eq } from "drizzle-orm";
import { account, household, householdMember, type Db } from "@ft/db";
import { ensureCategories } from "./context.js";
import { ImportError } from "./import.js";
import { reconcileSettlements, type SettlementSummary } from "./settlement.js";

export async function createHousehold(db: Db, name: string, members: { displayName: string; role?: "admin" | "member" | "viewer" }[]) {
  const [h] = await db.insert(household).values({ name }).returning();
  const created = await db
    .insert(householdMember)
    .values(members.map((m) => ({ householdId: h!.id, displayName: m.displayName, role: m.role ?? "member" })))
    .returning();
  await ensureCategories(db, h!.id);
  return { household: h!, members: created };
}

export type NewAccount = Omit<typeof account.$inferInsert, "id" | "householdId" | "createdAt" | "updatedAt">;

function validate(values: Partial<NewAccount>): void {
  if (values.billDescriptionPattern) {
    try {
      new RegExp(values.billDescriptionPattern, "u");
    } catch {
      throw new ImportError("bad_state", "The bill description pattern is not valid");
    }
  }
  if (values.numberLast4 && !/^\d{4}$/.test(values.numberLast4)) {
    throw new ImportError("bad_state", "Card number must be exactly 4 digits");
  }
}

export async function addAccount(db: Db, householdId: string, values: NewAccount) {
  validate(values);
  const [a] = await db.insert(account).values({ ...values, householdId }).returning();
  return a!;
}

/**
 * Updates an account and re-applies settlement rules, since ownership, statement tracking and
 * the bill pattern all decide how the bank's card debits are counted.
 */
export async function updateAccount(db: Db, householdId: string, accountId: string, values: Partial<NewAccount>) {
  validate(values);
  const [a] = await db
    .update(account)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(account.id, accountId), eq(account.householdId, householdId)))
    .returning();
  if (!a) throw new ImportError("not_found", "Account not found");
  await refreshSettlements(db, householdId);
  return a;
}

export async function refreshSettlements(db: Db, householdId: string): Promise<SettlementSummary> {
  const maps = await ensureCategories(db, householdId);
  return reconcileSettlements(db, householdId, maps.idBySlug.get("card_unitemized")!);
}
