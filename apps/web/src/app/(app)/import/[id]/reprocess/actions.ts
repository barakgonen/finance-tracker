"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { applyReprocess, ImportError } from "@ft/ingest";
import { householdScope, requireEditor } from "@/lib/auth";
import { ingestDeps, scope } from "@/lib/db";

export async function applyReprocessAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const importId = String(form.get("importId"));
  const reason = String(form.get("reason") ?? "").trim();
  let error: string | undefined;
  try {
    await scope(householdScope(viewer), (tx) =>
      applyReprocess(ingestDeps(tx), {
        householdId: viewer.householdId,
        importId,
        actorMemberId: viewer.memberId,
        removeMissing: form.get("removeMissing") === "on",
        overrideReconciliation: reason ? { reason } : undefined,
      }),
    );
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    error = e.message;
  }
  revalidatePath("/", "layout");
  redirect(error ? `/import/${importId}/reprocess?error=${encodeURIComponent(error)}` : `/import/${importId}?reprocessed=1`);
}
