"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { householdMember } from "@ft/db";
import { createInvitation, ImportError, revokeInvitation } from "@ft/ingest";
import { householdScope, requireAdmin } from "@/lib/auth";
import { scope } from "@/lib/db";

const ROLES = ["admin", "member", "viewer"] as const;
type Role = (typeof ROLES)[number];

export async function createInviteAction(form: FormData): Promise<void> {
  const viewer = await requireAdmin();
  const role = String(form.get("role"));
  const email = String(form.get("email") ?? "").trim();
  if (!(ROLES as readonly string[]).includes(role) || (email && !/^\S+@\S+\.\S+$/.test(email))) redirect("/settings/accounts?error=missing");
  let target: string;
  try {
    const { token } = await scope(householdScope(viewer), (tx) =>
      createInvitation(tx, {
        householdId: viewer.householdId,
        memberId: String(form.get("memberId")),
        role: role as Role,
        email: email || undefined,
        invitedBy: viewer.memberId,
      }),
    );
    // shown once on the next page; only its hash is stored
    target = `/settings/accounts?invite=${encodeURIComponent(token)}&member=${encodeURIComponent(String(form.get("memberId")))}`;
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    target = `/settings/accounts?error=${encodeURIComponent(e.message)}`;
  }
  revalidatePath("/settings/accounts");
  redirect(target);
}

export async function revokeInviteAction(form: FormData): Promise<void> {
  const viewer = await requireAdmin();
  await scope(householdScope(viewer), (tx) => revokeInvitation(tx, viewer.householdId, String(form.get("invitationId")), viewer.memberId));
  revalidatePath("/settings/accounts");
  redirect("/settings/accounts");
}

export async function addMemberAction(form: FormData): Promise<void> {
  const viewer = await requireAdmin();
  const name = String(form.get("displayName") ?? "").trim();
  if (!name) redirect("/settings/accounts?error=missing");
  await scope(householdScope(viewer), (tx) => tx.insert(householdMember).values({ householdId: viewer.householdId, displayName: name }));
  revalidatePath("/", "layout");
  redirect("/settings/accounts?saved=1");
}
