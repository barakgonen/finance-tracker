"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { TRANSACTION_KINDS, type TransactionKind } from "@ft/core";
import { correctTransaction } from "@ft/ingest";
import { householdScope, requireEditor } from "@/lib/auth";
import { scope } from "@/lib/db";
import { canSeeDetails, members } from "@/lib/queries";
import { transaction } from "@ft/db";
import { eq } from "drizzle-orm";

export async function correctAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const kind = String(form.get("kind") ?? "");
  const category = String(form.get("category") ?? "");
  const owner = String(form.get("owner") ?? "");
  if (!(TRANSACTION_KINDS as readonly string[]).includes(kind)) redirect("/review?error=1");

  await scope(householdScope(viewer), async (tx) => {
    const [t] = await tx.select({ accountId: transaction.accountId }).from(transaction).where(eq(transaction.id, String(form.get("transactionId"))));
    if (!t || !(await canSeeDetails(tx, viewer.householdId, t.accountId, viewer.memberId))) throw new Error("Transaction not found");
    // "shared" or one of this household's members; anything else is ignored
    const ownerMember = (await members(tx, viewer.householdId)).find((m) => m.id === owner);
    await correctTransaction(tx, {
      householdId: viewer.householdId,
      actorMemberId: viewer.memberId,
      transactionId: String(form.get("transactionId")),
      kind: kind as TransactionKind,
      category: category || null,
      ...(owner === "shared" ? { memberId: null, isShared: true } : ownerMember ? { memberId: ownerMember.id, isShared: false } : {}),
      applyToMerchant: form.get("applyToMerchant") === "on",
    });
  });
  revalidatePath("/", "layout");
  redirect("/review");
}
