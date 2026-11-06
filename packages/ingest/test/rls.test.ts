// Row-level security, exercised as the restricted role the app connects with.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { account, appUser, householdMember, invitation, scoped, transaction } from "@ft/db";
import {
  acceptInvitation,
  addAccount,
  commitImport,
  createHousehold,
  createInvitation,
  findInvitation,
  stageStatement,
} from "../src/index.js";
import { cardStatement, fileFor, row, startHarness, type Harness } from "./harness.js";

let h: Harness;
const A = randomUUID();
const B = randomUUID();
let aAdmin: string;
let aPartner: string;
let bMember: string;
let aCard: string;

beforeAll(async () => {
  h = await startHarness();
  const app = h.appDb;
  // both households are created through the restricted role, as the app does at setup
  await scoped(app, { householdId: A }, async (tx) => {
    const { members } = await createHousehold(tx, "A", [{ displayName: "a-admin", role: "admin" }, { displayName: "a-partner" }], A);
    aAdmin = members[0]!.id;
    aPartner = members[1]!.id;
    aCard = (await addAccount(tx, A, { type: "credit_card", institution: "cal", name: "A card", numberLast4: "1111", ownerMemberId: aAdmin })).id;
  });
  await scoped(app, { householdId: B }, async (tx) => {
    const { members } = await createHousehold(tx, "B", [{ displayName: "b-admin", role: "admin" }], B);
    bMember = members[0]!.id;
    await addAccount(tx, B, { type: "bank", institution: "leumi", name: "B bank" });
  });
});
afterAll(() => h?.stop());

describe("row-level security", () => {
  it("the app role cannot bypass or switch off the policies", async () => {
    const [role] = await h.appDb.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(role).toMatchObject({ rolsuper: false, rolbypassrls: false });
    await expect(h.appDb.execute(sql`alter table account disable row level security`)).rejects.toThrow();
  });

  it("each household sees only its own rows", async () => {
    const names = (id: string) => scoped(h.appDb, { householdId: id }, (tx) => tx.select({ name: account.name }).from(account));
    expect((await names(A)).map((r) => r.name)).toEqual(["A card"]);
    expect((await names(B)).map((r) => r.name)).toEqual(["B bank"]);
  });

  it("fails closed: without a scope nothing is visible", async () => {
    expect(await h.appDb.select().from(account)).toEqual([]);
    expect(await scoped(h.appDb, {}, (tx) => tx.select().from(householdMember))).toEqual([]);
  });

  it("blocks writing into another household, and updating its rows", async () => {
    await expect(
      scoped(h.appDb, { householdId: B }, (tx) => tx.insert(account).values({ householdId: A, type: "bank", institution: "x", name: "planted" })),
    ).rejects.toThrow(/row-level security/);
    const updated = await scoped(h.appDb, { householdId: B }, (tx) =>
      tx.update(account).set({ name: "hijacked" }).where(eq(account.id, aCard)).returning(),
    );
    expect(updated).toEqual([]);
  });

  it("a full import works under the policies and stays inside its household", async () => {
    const statement = cardStatement("cal", "1111", "2026-10-02", [row("2026-09-03", "שופרסל", -15000), row("2026-09-04", "WOLT", -5000)]);
    await scoped(h.appDb, { householdId: A }, async (tx) => {
      const deps = { db: tx, blobs: h.deps.blobs };
      const p = await stageStatement(deps, { householdId: A, file: fileFor(statement), statement });
      await commitImport(deps, { householdId: A, importId: p.importId });
    });
    const countIn = (id: string) => scoped(h.appDb, { householdId: id }, (tx) => tx.select().from(transaction));
    expect((await countIn(A)).length).toBe(2);
    expect((await countIn(B)).length).toBe(0);
  });

  it("a user sees their own membership row, and no one else's, before the household is known", async () => {
    const userId = await scoped(h.deps.db, {}, async (tx) => {
      const [u] = await tx.insert(appUser).values({ email: "b@x.co", displayName: "b", passwordHash: "x" }).returning();
      await tx.update(householdMember).set({ userId: u!.id }).where(eq(householdMember.id, bMember));
      return u!.id;
    });
    const rows = await scoped(h.appDb, { userId }, (tx) => tx.select().from(householdMember));
    expect(rows.map((r) => r.id)).toEqual([bMember]);
  });
});

describe("invitations", () => {
  it("invites a member, accepts once, and links the new login with the invited role", async () => {
    const { token } = await scoped(h.appDb, { householdId: A }, (tx) =>
      createInvitation(tx, { householdId: A, memberId: aPartner, role: "member", email: "Partner@X.co", invitedBy: aAdmin }),
    );
    const hash = (await import("../src/invitations.js")).hashInviteToken(token);

    // a wrong token reveals nothing
    expect(await scoped(h.appDb, { inviteTokenHash: "0".repeat(64) }, (tx) => findInvitation(tx, "wrong-token"))).toBeNull();

    const view = await scoped(h.appDb, { inviteTokenHash: hash }, (tx) => findInvitation(tx, token));
    expect(view).toEqual({ householdName: "A", memberName: "a-partner", email: "partner@x.co", role: "member" });

    const userId = await scoped(h.appDb, { inviteTokenHash: hash }, (tx) =>
      acceptInvitation(tx, { token, email: "partner@x.co", displayName: "Partner", passwordHash: "hash" }),
    );
    const [member] = await scoped(h.appDb, { householdId: A }, (tx) => tx.select().from(householdMember).where(eq(householdMember.id, aPartner)));
    expect(member).toMatchObject({ userId, role: "member", displayName: "Partner" });

    // single use
    await expect(
      scoped(h.appDb, { inviteTokenHash: hash }, (tx) => acceptInvitation(tx, { token, email: "other@x.co", displayName: "x", passwordHash: "h" })),
    ).rejects.toThrow(/invalid, used or expired/);
  });

  it("refuses to invite a member who already has a login, and revokes the previous pending invite", async () => {
    await expect(
      scoped(h.appDb, { householdId: A }, (tx) => createInvitation(tx, { householdId: A, memberId: aPartner, role: "member", invitedBy: aAdmin })),
    ).rejects.toThrow(/already has a login/);

    const extra = await scoped(h.appDb, { householdId: A }, async (tx) => {
      const [m] = await tx.insert(householdMember).values({ householdId: A, displayName: "kid" }).returning();
      await createInvitation(tx, { householdId: A, memberId: m!.id, role: "viewer", invitedBy: aAdmin });
      await createInvitation(tx, { householdId: A, memberId: m!.id, role: "viewer", invitedBy: aAdmin });
      return m!.id;
    });
    const invites = await scoped(h.appDb, { householdId: A }, (tx) => tx.select().from(invitation).where(eq(invitation.memberId, extra)));
    expect(invites.filter((i) => !i.revokedAt).length).toBe(1);
  });

  it("an expired invite cannot be used", async () => {
    const { token } = await scoped(h.appDb, { householdId: B }, async (tx) => {
      const [m] = await tx.insert(householdMember).values({ householdId: B, displayName: "late" }).returning();
      const created = await createInvitation(tx, { householdId: B, memberId: m!.id, role: "member", invitedBy: bMember });
      await tx.update(invitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitation.memberId, m!.id));
      return created;
    });
    const hash = (await import("../src/invitations.js")).hashInviteToken(token);
    expect(await scoped(h.appDb, { inviteTokenHash: hash }, (tx) => findInvitation(tx, token))).toBeNull();
  });
});
