"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deleteBudget, ImportError, setBudget } from "@ft/ingest";
import { householdScope, requireEditor } from "@/lib/auth";
import { scope } from "@/lib/db";
import { parseShekels } from "@/lib/format";

const back = (form: FormData, q: string): never => {
  const p = new URLSearchParams(q);
  for (const k of ["month", "view"]) if (form.get(k)) p.set(k, String(form.get(k)));
  redirect(`/budgets?${p}`);
};

export async function setBudgetAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const limit = parseShekels(form.get("limit"));
  const ratio = Number(form.get("alert") ?? 80) / 100;
  if (!limit) back(form, "error=limit");
  let error: string | undefined;
  try {
    await scope(householdScope(viewer), (tx) =>
      setBudget(tx, viewer.householdId, {
        categorySlug: String(form.get("category") ?? ""),
        monthlyLimitMinor: limit!,
        alertRatio: ratio,
        memberId: String(form.get("view") ?? "") || null,
        actorMemberId: viewer.memberId,
      }),
    );
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    error = e.message;
  }
  revalidatePath("/", "layout");
  back(form, error ? `error=${encodeURIComponent(error)}` : "saved=1");
}

export async function deleteBudgetAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  await scope(householdScope(viewer), (tx) => deleteBudget(tx, viewer.householdId, String(form.get("budgetId")), viewer.memberId));
  revalidatePath("/", "layout");
  back(form, "saved=1");
}
