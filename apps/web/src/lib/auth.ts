import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, sql } from "drizzle-orm";
import { appUser, householdMember, session } from "@ft/db";
import { db } from "./db";
import { env } from "./env";
import { AttemptLimiter, hashToken, newSessionToken } from "./auth-core";

const COOKIE = "ft_session";
const SESSION_DAYS = 7;

export const loginLimiter = new AttemptLimiter(5, 15 * 60_000);
export const totpLimiter = new AttemptLimiter(5, 15 * 60_000);

export async function hasUsers(): Promise<boolean> {
  const [r] = await db().select({ n: sql<number>`count(*)::int` }).from(appUser);
  return (r?.n ?? 0) > 0;
}

export async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function startSession(userId: string, totpVerified = false): Promise<void> {
  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db().insert(session).values({ tokenHash, userId, totpVerified, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db().delete(session).where(eq(session.tokenHash, hashToken(token)));
  jar.delete(COOKIE);
}

/** The current session and its user, whatever the 2FA state; null when signed out. */
export async function currentSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db()
    .select({ session, user: appUser })
    .from(session)
    .innerJoin(appUser, eq(appUser.id, session.userId))
    .where(and(eq(session.tokenHash, hashToken(token)), gt(session.expiresAt, new Date())));
  return row ?? null;
}

export async function markTotpVerified(sessionId: string): Promise<void> {
  await db().update(session).set({ totpVerified: true, lastSeenAt: new Date() }).where(eq(session.id, sessionId));
}

export interface Viewer {
  userId: string;
  displayName: string;
  email: string;
  locale: string;
  memberId: string;
  householdId: string;
  role: "admin" | "member" | "viewer";
}

/** For every app page and action: a fully signed-in (password + TOTP) household member. */
export async function requireViewer(): Promise<Viewer> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (!s.user.totpConfirmedAt) redirect("/setup/totp");
  if (!s.session.totpVerified) redirect("/login/verify");
  const [member] = await db().select().from(householdMember).where(eq(householdMember.userId, s.user.id));
  if (!member) redirect("/login");
  return {
    userId: s.user.id,
    displayName: s.user.displayName,
    email: s.user.email,
    locale: s.user.locale,
    memberId: member.id,
    householdId: member.householdId,
    role: member.role,
  };
}

/** Like requireViewer, but refuses read-only members. */
export async function requireEditor(): Promise<Viewer> {
  const v = await requireViewer();
  if (v.role === "viewer") throw new Error("Read-only members can't make changes");
  return v;
}
