"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { appUser, householdMember } from "@ft/db";
import { createHousehold } from "@ft/ingest";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  clientKey,
  currentSession,
  hasUsers,
  endSession,
  loginLimiter,
  markTotpVerified,
  startSession,
  totpLimiter,
} from "@/lib/auth";
import { decryptSecret, dummyPasswordHash, hashPassword, MIN_PASSWORD_LENGTH, totp, verifyPassword } from "@/lib/auth-core";

/** Errors go back as a query parameter so these forms work the same with or without JavaScript. */
function fail(path: string, error: string): never {
  redirect(`${path}?error=${error}`);
}

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** First run only: creates the household, its members and the admin user. */
export async function setupAction(form: FormData): Promise<void> {
  if (await hasUsers()) redirect("/login");
  const householdName = text(form, "householdName");
  const displayName = text(form, "displayName");
  const partnerName = text(form, "partnerName");
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!householdName || !displayName || !/^\S+@\S+\.\S+$/.test(email) || password.length < MIN_PASSWORD_LENGTH) {
    fail("/setup", "invalid");
  }
  const passwordHash = await hashPassword(password);
  const userId = await db().transaction(async (tx) => {
    const members = [{ displayName, role: "admin" as const }, ...(partnerName ? [{ displayName: partnerName }] : [])];
    const { members: created } = await createHousehold(tx, householdName, members);
    const [user] = await tx.insert(appUser).values({ email, displayName, passwordHash }).returning({ id: appUser.id });
    await tx.update(householdMember).set({ userId: user!.id }).where(eq(householdMember.id, created[0]!.id));
    return user!.id;
  });
  await startSession(userId);
  redirect("/setup/totp");
}

export async function loginAction(form: FormData): Promise<void> {
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const key = `${email}|${await clientKey()}`;
  if (!loginLimiter.attempt(key)) fail("/login", "locked");

  const [user] = await db().select().from(appUser).where(eq(appUser.email, email));
  const ok = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), password);
  if (!user || !ok) fail("/login", "badCredentials");

  loginLimiter.reset(key);
  await startSession(user.id);
  redirect(user.totpConfirmedAt ? "/login/verify" : "/setup/totp");
}

export async function verifyTotpAction(form: FormData): Promise<void> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (!s.user.totpSecretEnc || !s.user.totpConfirmedAt) redirect("/setup/totp");
  if (!totpLimiter.attempt(s.user.id)) fail("/login/verify", "locked");
  const code = text(form, "code").replace(/\s/g, "");
  if (!totp.check(code, decryptSecret(env.encryptionKey, s.user.totpSecretEnc))) fail("/login/verify", "badCode");
  totpLimiter.reset(s.user.id);
  await markTotpVerified(s.session.id);
  redirect("/");
}

/** Confirms TOTP enrollment with a first valid code. */
export async function confirmTotpAction(form: FormData): Promise<void> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.user.totpConfirmedAt || !s.user.totpSecretEnc) redirect("/");
  if (!totpLimiter.attempt(s.user.id)) fail("/setup/totp", "locked");
  const code = text(form, "code").replace(/\s/g, "");
  if (!totp.check(code, decryptSecret(env.encryptionKey, s.user.totpSecretEnc))) fail("/setup/totp", "badCode");
  totpLimiter.reset(s.user.id);
  await db().update(appUser).set({ totpConfirmedAt: new Date(), updatedAt: new Date() }).where(eq(appUser.id, s.user.id));
  await markTotpVerified(s.session.id);
  redirect("/settings/accounts");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}
