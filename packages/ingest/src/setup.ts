// Household and account setup used by onboarding (and tests).
import { account, household, householdMember, type Db } from "@ft/db";
import { ensureCategories } from "./context.js";

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

export async function addAccount(db: Db, householdId: string, values: NewAccount) {
  const [a] = await db.insert(account).values({ ...values, householdId }).returning();
  return a!;
}
