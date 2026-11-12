"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createCategory, deleteCategory, ImportError, renameCategory } from "@ft/ingest";
import { householdScope, requireEditor } from "@/lib/auth";
import { scope } from "@/lib/db";

/** Runs a category change and comes back with ?saved=1 or the (translated on the page) error. */
async function run(fn: (tx: Parameters<Parameters<typeof scope>[1]>[0], v: Awaited<ReturnType<typeof requireEditor>>) => Promise<unknown>): Promise<never> {
  const viewer = await requireEditor();
  let error: string | undefined;
  try {
    await scope(householdScope(viewer), (tx) => fn(tx, viewer));
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    error = e.message;
  }
  revalidatePath("/", "layout");
  redirect(`/settings/categories?${error ? `error=${encodeURIComponent(error)}` : "saved=1"}`);
}

export async function createCategoryAction(form: FormData): Promise<void> {
  const type = form.get("type") === "income" ? "income" : "expense";
  await run((tx, v) => createCategory(tx, { householdId: v.householdId, type, name: String(form.get("name") ?? ""), nameEn: String(form.get("nameEn") ?? ""), actorMemberId: v.memberId }));
}

export async function renameCategoryAction(form: FormData): Promise<void> {
  await run((tx, v) =>
    renameCategory(tx, { householdId: v.householdId, categoryId: String(form.get("id")), name: String(form.get("name") ?? ""), nameEn: String(form.get("nameEn") ?? ""), actorMemberId: v.memberId }),
  );
}

export async function deleteCategoryAction(form: FormData): Promise<void> {
  await run((tx, v) =>
    deleteCategory(tx, { householdId: v.householdId, categoryId: String(form.get("id")), moveTo: String(form.get("moveTo") ?? "") || null, actorMemberId: v.memberId }),
  );
}
