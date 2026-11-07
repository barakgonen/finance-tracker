"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { setInsightState } from "@ft/ingest";
import { householdScope, requireEditor } from "@/lib/auth";
import { scope } from "@/lib/db";

export async function insightStateAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const status = String(form.get("status"));
  const returnTo = String(form.get("returnTo") ?? "/insights");
  await scope(householdScope(viewer), (tx) =>
    setInsightState(tx, viewer.householdId, String(form.get("insightId")), status === "done" || status === "dismissed" ? status : null, viewer.memberId),
  );
  revalidatePath("/", "layout");
  // only app-internal paths ("//host" and "/\\host" would leave the site)
  redirect(/^\/(?![/\\])/.test(returnTo) ? returnTo : "/insights");
}
