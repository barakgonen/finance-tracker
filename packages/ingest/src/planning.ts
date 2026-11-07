// Creating and changing budgets and goals (validated and audit-logged).
import { and, eq, isNull } from "drizzle-orm";
import { auditLog, budget, category, goal, householdMember, insightState, type Db } from "@ft/db";
import { ImportError } from "./import.js";

async function categoryId(db: Db, householdId: string, slug: string): Promise<string> {
  const [c] = await db.select({ id: category.id, type: category.type }).from(category).where(and(eq(category.householdId, householdId), eq(category.slug, slug)));
  if (!c || c.type !== "expense") throw new ImportError("bad_state", "Choose a spending category");
  return c.id;
}

async function checkMember(db: Db, householdId: string, memberId: string | null): Promise<void> {
  if (!memberId) return;
  const [m] = await db.select({ id: householdMember.id }).from(householdMember).where(and(eq(householdMember.id, memberId), eq(householdMember.householdId, householdId)));
  if (!m) throw new ImportError("not_found", "Member not found");
}

const audit = (db: Db, householdId: string, actor: string | undefined, entity: string, entityId: string, action: string, after?: unknown) =>
  db.insert(auditLog).values({ householdId, actorMemberId: actor ?? null, entity, entityId, action, after: after ?? null });

export async function setBudget(
  db: Db,
  householdId: string,
  input: { categorySlug: string; monthlyLimitMinor: bigint; memberId?: string | null; alertRatio?: number; actorMemberId?: string },
): Promise<string> {
  if (input.monthlyLimitMinor <= 0n) throw new ImportError("bad_state", "The limit must be positive");
  const ratio = input.alertRatio ?? 0.8;
  if (!(ratio > 0 && ratio <= 1)) throw new ImportError("bad_state", "The alert threshold must be between 1% and 100%");
  const memberId = input.memberId ?? null;
  await checkMember(db, householdId, memberId);
  const cat = await categoryId(db, householdId, input.categorySlug);
  // one budget per category per scope: setting it again changes the limit
  const [existing] = await db
    .select({ id: budget.id })
    .from(budget)
    .where(and(eq(budget.householdId, householdId), eq(budget.categoryId, cat), memberId ? eq(budget.memberId, memberId) : isNull(budget.memberId)));
  const values = { monthlyLimit: input.monthlyLimitMinor, alertRatio: ratio, updatedAt: new Date() };
  const id = existing
    ? (await db.update(budget).set(values).where(eq(budget.id, existing.id)).returning({ id: budget.id }))[0]!.id
    : (await db.insert(budget).values({ householdId, categoryId: cat, memberId, ...values }).returning({ id: budget.id }))[0]!.id;
  await audit(db, householdId, input.actorMemberId, "budget", id, existing ? "update" : "create", { categorySlug: input.categorySlug, limit: String(input.monthlyLimitMinor), ratio });
  return id;
}

export async function deleteBudget(db: Db, householdId: string, budgetId: string, actorMemberId?: string): Promise<void> {
  const [b] = await db.delete(budget).where(and(eq(budget.id, budgetId), eq(budget.householdId, householdId))).returning({ id: budget.id });
  if (!b) throw new ImportError("not_found", "Budget not found");
  await audit(db, householdId, actorMemberId, "budget", b.id, "delete");
}

export type NewGoal =
  | { type: "save_amount"; name: string; targetAmountMinor: bigint; deadline?: string | null }
  | { type: "savings_rate"; name: string; targetRate: number }
  | { type: "reduce_category"; name: string; categorySlug: string; reducePct: number; baselineMonthlyMinor: bigint };

export async function createGoal(db: Db, householdId: string, input: NewGoal & { startMonth: string; memberId?: string | null; actorMemberId?: string }): Promise<string> {
  if (!input.name.trim()) throw new ImportError("bad_state", "Give the goal a name");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.startMonth)) throw new ImportError("bad_state", "Invalid start month");
  await checkMember(db, householdId, input.memberId ?? null);
  const base = { householdId, name: input.name.trim(), type: input.type, startMonth: input.startMonth, memberId: input.memberId ?? null };
  let values: typeof goal.$inferInsert;
  if (input.type === "save_amount") {
    if (input.targetAmountMinor <= 0n) throw new ImportError("bad_state", "The target must be positive");
    if (input.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(input.deadline) || input.deadline.slice(0, 7) <= input.startMonth)) {
      throw new ImportError("bad_state", "The deadline must be after the start month");
    }
    values = { ...base, targetAmount: input.targetAmountMinor, deadline: input.deadline ?? null };
  } else if (input.type === "savings_rate") {
    if (!(input.targetRate > 0 && input.targetRate < 1)) throw new ImportError("bad_state", "The rate must be between 1% and 99%");
    values = { ...base, targetRate: input.targetRate };
  } else {
    if (!(input.reducePct > 0 && input.reducePct < 1)) throw new ImportError("bad_state", "The reduction must be between 1% and 99%");
    if (input.baselineMonthlyMinor <= 0n) throw new ImportError("bad_state", "There's no recent spending in this category to reduce");
    values = { ...base, categoryId: await categoryId(db, householdId, input.categorySlug), reducePct: input.reducePct, baselineMonthly: input.baselineMonthlyMinor };
  }
  const [g] = await db.insert(goal).values(values).returning({ id: goal.id });
  await audit(db, householdId, input.actorMemberId, "goal", g!.id, "create", { type: input.type, name: input.name });
  return g!.id;
}

export async function archiveGoal(db: Db, householdId: string, goalId: string, actorMemberId?: string): Promise<void> {
  const [g] = await db
    .update(goal)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(goal.id, goalId), eq(goal.householdId, householdId)))
    .returning({ id: goal.id });
  if (!g) throw new ImportError("not_found", "Goal not found");
  await audit(db, householdId, actorMemberId, "goal", g.id, "archive");
}

/** Marks an insight handled or not relevant for the household, or clears the mark (status null). */
export async function setInsightState(db: Db, householdId: string, insightId: string, status: "done" | "dismissed" | null, actorMemberId?: string): Promise<void> {
  // ids look like "price_increase:out|<merchant id>:2026-10-04" (see detectInsights)
  if (!/^[a-z_]+:[\w:.|\-]+$/.test(insightId) || insightId.length > 300) throw new ImportError("bad_state", "Invalid insight");
  if (status === null) {
    await db.delete(insightState).where(and(eq(insightState.householdId, householdId), eq(insightState.insightId, insightId)));
  } else {
    await db
      .insert(insightState)
      .values({ householdId, insightId, status, memberId: actorMemberId ?? null })
      .onConflictDoUpdate({ target: [insightState.householdId, insightState.insightId], set: { status, memberId: actorMemberId ?? null, updatedAt: new Date() } });
  }
  await db.insert(auditLog).values({ householdId, actorMemberId: actorMemberId ?? null, entity: "insight", entityId: crypto.randomUUID(), action: status ?? "reopen", after: { insightId } });
}
