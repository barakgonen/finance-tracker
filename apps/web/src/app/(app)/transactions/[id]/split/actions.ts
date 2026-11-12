"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { transaction } from "@ft/db";
import { ImportError, setSplits, type SplitPart } from "@ft/ingest";
import { householdScope, requireEditor } from "@/lib/auth";
import { scope } from "@/lib/db";
import { parseShekels } from "@/lib/format";
import { canSeeDetails } from "@/lib/queries";

const MAX_PARTS = 8;

const backOf = (form: FormData) => {
  const back = String(form.get("back") ?? "");
  // only paths inside the app (no //host or \\host)
  return /^\/(?![/\\])/.test(back) ? back : "/transactions";
};
const errorPage = (form: FormData, error: string): never => {
  const id = String(form.get("transactionId"));
  if (!/^[0-9a-f-]{36}$/.test(id)) redirect("/transactions");
  return redirect(`/transactions/${id}/split?error=${encodeURIComponent(error)}&back=${encodeURIComponent(backOf(form))}`);
};

async function fail(form: FormData, error: string): Promise<never> {
  await requireEditor();
  return errorPage(form, error);
}

async function save(form: FormData, parts: SplitPart[]): Promise<never> {
  const viewer = await requireEditor();
  const id = String(form.get("transactionId"));
  let error: string | undefined;
  try {
    await scope(householdScope(viewer), async (tx) => {
      const [t] = await tx.select({ accountId: transaction.accountId }).from(transaction).where(eq(transaction.id, id));
      if (!t || !(await canSeeDetails(tx, viewer.householdId, t.accountId, viewer.memberId))) throw new ImportError("not_found", "Transaction not found");
      await setSplits(tx, { householdId: viewer.householdId, transactionId: id, parts, actorMemberId: viewer.memberId });
    });
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    error = e.message;
  }
  revalidatePath("/", "layout");
  return error ? errorPage(form, error) : redirect(backOf(form));
}

export async function splitAction(form: FormData): Promise<void> {
  const parts: SplitPart[] = [];
  for (let i = 0; i < MAX_PARTS; i++) {
    const raw = String(form.get(`amount-${i}`) ?? "").trim();
    if (!raw) continue;
    const amountMinor = parseShekels(raw);
    if (amountMinor === null || amountMinor === 0n) return fail(form, "Every part needs a positive amount");
    parts.push({ amountMinor, category: String(form.get(`category-${i}`) ?? "") || null });
  }
  // fewer than two parts is a mistake, not a request to remove the split (that has its own button)
  if (parts.length < 2) return fail(form, "A split needs at least two parts");
  return save(form, parts);
}

export async function unsplitAction(form: FormData): Promise<void> {
  return save(form, []);
}
