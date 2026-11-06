"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { commitImport, discardImport, ImportError, stageImport } from "@ft/ingest";
import { requireEditor } from "@/lib/auth";
import { ingestDeps } from "@/lib/db";

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = /\.(pdf|xlsx|xls|csv)$/i;

export async function uploadAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || !ALLOWED.test(file.name)) redirect("/import?error=bad_file");
  if (file.size > MAX_BYTES) redirect("/import?error=too_large");
  const accountId = String(form.get("accountId") ?? "") || undefined;

  let target: string;
  try {
    const preview = await stageImport(ingestDeps(), {
      householdId: viewer.householdId,
      uploadedBy: viewer.memberId,
      accountId,
      file: { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    });
    target = `/import/${preview.importId}`;
  } catch (e) {
    if (e instanceof ImportError && e.code === "duplicate_file") {
      const existing = (e.details as { importId?: string } | undefined)?.importId;
      target = `/import?error=duplicate${existing ? `&existing=${existing}` : ""}`;
    } else {
      throw e;
    }
  }
  redirect(target);
}

export async function commitAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const importId = String(form.get("importId"));
  const accountId = String(form.get("accountId") ?? "") || undefined;
  const reason = String(form.get("reason") ?? "").trim();
  let error: string | undefined;
  try {
    await commitImport(ingestDeps(), {
      householdId: viewer.householdId,
      importId,
      actorMemberId: viewer.memberId,
      accountId,
      overrideReconciliation: reason ? { reason } : undefined,
    });
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    error = e.code;
  }
  revalidatePath("/", "layout");
  redirect(`/import/${importId}${error ? `?error=${error}` : ""}`);
}

export async function discardAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const importId = String(form.get("importId"));
  await discardImport(ingestDeps(), viewer.householdId, importId, viewer.memberId);
  redirect("/import");
}
