"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { TRANSACTION_KINDS, type TransactionKind } from "@ft/core";
import { correctTransaction } from "@ft/ingest";
import { requireEditor } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/queries";

export async function correctAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const kind = String(form.get("kind") ?? "");
  const category = String(form.get("category") ?? "");
  const owner = String(form.get("owner") ?? "");
  if (!(TRANSACTION_KINDS as readonly string[]).includes(kind)) redirect("/review?error=1");

  // "shared" or one of this household's members; anything else is ignored
  const householdMembers = await members(viewer.householdId);
  const ownerMember = householdMembers.find((m) => m.id === owner);

  await correctTransaction(db(), {
    householdId: viewer.householdId,
    actorMemberId: viewer.memberId,
    transactionId: String(form.get("transactionId")),
    kind: kind as TransactionKind,
    category: category || null,
    ...(owner === "shared" ? { memberId: null, isShared: true } : ownerMember ? { memberId: ownerMember.id, isShared: false } : {}),
    applyToMerchant: form.get("applyToMerchant") === "on",
  });
  revalidatePath("/", "layout");
  redirect("/review");
}
