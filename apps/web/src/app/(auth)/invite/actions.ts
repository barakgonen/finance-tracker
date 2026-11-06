"use server";

import { redirect } from "next/navigation";
import { acceptInvitation, hashInviteToken, ImportError } from "@ft/ingest";
import { startSession } from "@/lib/auth";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth-core";
import { scope } from "@/lib/db";

export async function acceptInviteAction(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const back = (error: string): never => redirect(`/invite/${encodeURIComponent(token)}?error=${error}`);
  const email = String(form.get("email") ?? "").trim();
  const displayName = String(form.get("displayName") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!token || !displayName || !/^\S+@\S+\.\S+$/.test(email) || password.length < MIN_PASSWORD_LENGTH) back("invalid_form");

  const passwordHash = await hashPassword(password);
  let userId: string | undefined;
  let error: string | undefined;
  try {
    userId = await scope({ inviteTokenHash: hashInviteToken(token) }, (tx) => acceptInvitation(tx, { token, email, displayName, passwordHash }));
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    error = e.message === "email_taken" ? "email_taken" : "invalid";
  }
  if (error || !userId) back(error ?? "invalid");
  await startSession(userId!);
  // two-factor enrollment is mandatory for invitees too
  redirect("/setup/totp");
}
