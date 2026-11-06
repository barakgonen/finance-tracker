"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ImportError, mergeMerchants, renameMerchant, setMerchantCategory } from "@ft/ingest";
import { householdScope, requireEditor } from "@/lib/auth";
import { scope } from "@/lib/db";

async function run(merchantId: string, fn: Parameters<typeof scope>[1], doneTo = merchantId): Promise<never> {
  const viewer = await requireEditor();
  let error: string | undefined;
  try {
    await scope(householdScope(viewer), fn);
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    error = e.message;
  }
  revalidatePath("/", "layout");
  redirect(`/merchants/${doneTo}${error ? `?error=${encodeURIComponent(error)}` : "?saved=1"}`);
}

export async function renameMerchantAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const id = String(form.get("merchantId"));
  await run(id, (tx) => renameMerchant(tx, viewer.householdId, id, String(form.get("name") ?? ""), viewer.memberId));
}

export async function setMerchantCategoryAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const id = String(form.get("merchantId"));
  const slug = String(form.get("category") ?? "") || null;
  await run(id, (tx) => setMerchantCategory(tx, viewer.householdId, id, slug, viewer.memberId));
}

export async function mergeMerchantAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const id = String(form.get("merchantId"));
  const target = String(form.get("targetId") ?? "");
  if (!target) redirect(`/merchants/${id}?error=missing`);
  await run(id, (tx) => mergeMerchants(tx, viewer.householdId, id, target, viewer.memberId), target);
}
