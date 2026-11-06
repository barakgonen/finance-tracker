// One-time invite links that let a household member get their own login.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { appUser, applyScope, auditLog, household, householdMember, invitation, type Db } from "@ft/db";
import { ImportError } from "./import.js";

const INVITE_DAYS = 7;

export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface CreateInvitationInput {
  householdId: string;
  memberId: string;
  role: "admin" | "member" | "viewer";
  email?: string;
  invitedBy: string;
}

/**
 * Creates an invite for a member who has no login yet and returns the token, which is shown
 * once and never stored. Any earlier pending invite for that member is revoked.
 * Call within a transaction scoped to the household.
 */
export async function createInvitation(db: Db, input: CreateInvitationInput): Promise<{ token: string; expiresAt: Date }> {
  const [member] = await db
    .select()
    .from(householdMember)
    .where(and(eq(householdMember.id, input.memberId), eq(householdMember.householdId, input.householdId)));
  if (!member) throw new ImportError("not_found", "Member not found");
  if (member.userId) throw new ImportError("bad_state", "This member already has a login");

  const now = new Date();
  await db
    .update(invitation)
    .set({ revokedAt: now })
    .where(and(eq(invitation.memberId, member.id), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)));

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000);
  const [inv] = await db
    .insert(invitation)
    .values({
      householdId: input.householdId,
      memberId: member.id,
      email: input.email?.toLowerCase() || null,
      role: input.role,
      tokenHash: hashInviteToken(token),
      invitedBy: input.invitedBy,
      expiresAt,
    })
    .returning({ id: invitation.id });
  await db.insert(auditLog).values({
    householdId: input.householdId,
    actorMemberId: input.invitedBy,
    entity: "invitation",
    entityId: inv!.id,
    action: "create",
    after: { memberId: member.id, role: input.role, email: input.email ?? null },
  });
  return { token, expiresAt };
}

export interface InvitationView {
  householdName: string;
  memberName: string;
  email: string | null;
  role: "admin" | "member" | "viewer";
}

/**
 * Looks up a still-usable invite by its token. Call within a transaction scoped with
 * `inviteTokenHash`; the household becomes readable only through the invite.
 */
export async function findInvitation(db: Db, token: string): Promise<InvitationView | null> {
  const [inv] = await db
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.tokenHash, hashInviteToken(token)),
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
        gt(invitation.expiresAt, new Date()),
      ),
    );
  if (!inv) return null;
  await applyScope(db, { householdId: inv.householdId });
  const [h] = await db.select({ name: household.name }).from(household).where(eq(household.id, inv.householdId));
  const [m] = await db.select({ name: householdMember.displayName }).from(householdMember).where(eq(householdMember.id, inv.memberId));
  return { householdName: h!.name, memberName: m!.name, email: inv.email, role: inv.role };
}

export interface AcceptInvitationInput {
  token: string;
  email: string;
  displayName: string;
  passwordHash: string;
}

/**
 * Turns an invite into a login: creates the user, links the member, applies the invited role.
 * Single use: concurrent or repeated acceptance fails. Returns the new user's id.
 */
export async function acceptInvitation(db: Db, input: AcceptInvitationInput): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const usable = and(
    eq(invitation.tokenHash, hashInviteToken(input.token)),
    isNull(invitation.acceptedAt),
    isNull(invitation.revokedAt),
    gt(invitation.expiresAt, new Date()),
  );
  // the token makes the invite readable; writing requires its household's scope (RLS WITH CHECK)
  const [found] = await db.select({ householdId: invitation.householdId }).from(invitation).where(usable);
  if (!found) throw new ImportError("bad_state", "This invite link is invalid, used or expired");
  await applyScope(db, { householdId: found.householdId });
  // conditional update: of two concurrent acceptances only one finds the row still unaccepted
  const [inv] = await db.update(invitation).set({ acceptedAt: new Date() }).where(usable).returning();
  if (!inv) throw new ImportError("bad_state", "This invite link is invalid, used or expired");

  const [taken] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, email));
  if (taken) throw new ImportError("bad_state", "email_taken");
  const [user] = await db
    .insert(appUser)
    .values({ email, displayName: input.displayName.trim(), passwordHash: input.passwordHash })
    .returning({ id: appUser.id });
  const [member] = await db
    .update(householdMember)
    .set({ userId: user!.id, role: inv.role, displayName: input.displayName.trim(), updatedAt: new Date() })
    .where(and(eq(householdMember.id, inv.memberId), isNull(householdMember.userId)))
    .returning({ id: householdMember.id });
  if (!member) throw new ImportError("bad_state", "This member already has a login");
  await db.insert(auditLog).values({
    householdId: inv.householdId,
    actorMemberId: member.id,
    entity: "invitation",
    entityId: inv.id,
    action: "accept",
    after: { userId: user!.id, email },
  });
  return user!.id;
}

export async function revokeInvitation(db: Db, householdId: string, invitationId: string, actorMemberId: string): Promise<void> {
  const [inv] = await db
    .update(invitation)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitation.id, invitationId), eq(invitation.householdId, householdId), isNull(invitation.acceptedAt)))
    .returning({ id: invitation.id });
  if (!inv) throw new ImportError("not_found", "Invitation not found");
  await db.insert(auditLog).values({ householdId, actorMemberId, entity: "invitation", entityId: inv.id, action: "revoke" });
}

export async function pendingInvitations(db: Db, householdId: string) {
  return db
    .select()
    .from(invitation)
    .where(
      and(eq(invitation.householdId, householdId), isNull(invitation.acceptedAt), isNull(invitation.revokedAt), gt(invitation.expiresAt, new Date())),
    );
}
