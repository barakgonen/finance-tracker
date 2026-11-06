"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { categoryBreakdown } from "@ft/analytics";
import { archiveGoal, createGoal, ImportError, type NewGoal } from "@ft/ingest";
import { householdScope, requireEditor } from "@/lib/auth";
import { scope } from "@/lib/db";
import { parseShekels } from "@/lib/format";

export async function createGoalAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const type = String(form.get("type"));
  const month = String(form.get("month") ?? new Date().toISOString().slice(0, 7));
  const memberId = String(form.get("view") ?? "") || null;
  const name = String(form.get("name") ?? "");
  let error: string | undefined;
  try {
    await scope(householdScope(viewer), async (tx) => {
      let goal: NewGoal;
      if (type === "save_amount") {
        const target = parseShekels(form.get("target"));
        if (!target) throw new ImportError("bad_state", "יש להזין סכום יעד");
        goal = { type, name, targetAmountMinor: target, deadline: String(form.get("deadline") ?? "") || null };
      } else if (type === "savings_rate") {
        goal = { type, name, targetRate: Number(form.get("rate")) / 100 };
      } else {
        const slug = String(form.get("category") ?? "");
        // the baseline is the category's average over the three months before the goal starts
        const cats = await categoryBreakdown(tx, { householdId: viewer.householdId, memberId: memberId ?? undefined }, month);
        const baseline = cats.find((c) => c.slug === slug)?.avg3Minor ?? 0n;
        goal = { type: "reduce_category", name, categorySlug: slug, reducePct: Number(form.get("pct")) / 100, baselineMonthlyMinor: baseline };
      }
      await createGoal(tx, viewer.householdId, { ...goal, startMonth: month, memberId, actorMemberId: viewer.memberId });
    });
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    error = e.message;
  }
  revalidatePath("/", "layout");
  const q = new URLSearchParams({ month, ...(memberId ? { view: memberId } : {}), ...(error ? { error } : { saved: "1" }) });
  redirect(`/goals?${q}`);
}

export async function archiveGoalAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  await scope(householdScope(viewer), (tx) => archiveGoal(tx, viewer.householdId, String(form.get("goalId")), viewer.memberId));
  revalidatePath("/", "layout");
  redirect(`/goals?month=${encodeURIComponent(String(form.get("month") ?? ""))}`);
}
