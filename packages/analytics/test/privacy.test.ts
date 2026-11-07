// Private accounts: other members see their amounts in totals, never their transactions or merchants.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { merchant, scoped, type Db } from "@ft/db";
import { addAccount, commitImport, createHousehold, stageStatement } from "@ft/ingest";
import type { ParsedStatement } from "@ft/parsers";
import { cardStatement, fileFor, row, startHarness, type Harness } from "../../ingest/test/harness.js";
import { categoryBreakdown, largestTransactions, listTransactions, merchantBreakdown, merchantDetail, merchantList, monthTotals, recurringSeries } from "../src/index.js";

let h: Harness;
const HH = randomUUID();
let me: string;
let partner: string;
const q = <T>(fn: (tx: Db) => Promise<T>) => scoped(h.appDb, { householdId: HH }, fn);

beforeAll(async () => {
  h = await startHarness();
  const ids = await q(async (tx) => {
    const { members } = await createHousehold(tx, "t", [{ displayName: "me", role: "admin" }, { displayName: "partner" }], HH);
    const mine = await addAccount(tx, HH, { type: "credit_card", institution: "cal", name: "mine", numberLast4: "1111", ownerMemberId: members[0]!.id });
    const hers = await addAccount(tx, HH, { type: "credit_card", institution: "max", name: "hers", numberLast4: "2222", ownerMemberId: members[1]!.id, visibility: "private" });
    return { me: members[0]!.id, partner: members[1]!.id, mine: mine.id, hers: hers.id };
  });
  me = ids.me;
  partner = ids.partner;
  const load = (s: ParsedStatement, accountId: string) =>
    q(async (tx) => {
      const deps = { db: tx, blobs: h.deps.blobs };
      const p = await stageStatement(deps, { householdId: HH, file: fileFor(s), statement: s, accountId });
      await commitImport(deps, { householdId: HH, importId: p.importId });
    });
  await load(cardStatement("cal", "1111", "2026-10-28", [row("2026-10-03", "שופרסל", -30000)]), ids.mine);
  for (const m of ["07", "08", "09", "10"]) {
    await load(cardStatement("max", "2222", `2026-${m}-28`, [row(`2026-${m}-05`, "בוטיק סודי", -50000), row(`2026-${m}-06`, "Spotify P46B9945EB", -2390)]), ids.hers);
  }
});
afterAll(() => h?.stop());

const asMe = () => ({ householdId: HH, viewerMemberId: me });
const asPartner = () => ({ householdId: HH, viewerMemberId: partner });
const OCT = { from: "2026-10-01", to: "2026-11-01" };

describe("private accounts", () => {
  it("still count in totals and category sums for everyone", async () => {
    const t = await q((tx) => monthTotals(tx, asMe(), "2026-10"));
    expect(t.expensesMinor).toBe(30000n + 50000n + 2390n);
    const cats = await q((tx) => categoryBreakdown(tx, asMe(), "2026-10"));
    expect(cats.reduce((a, c) => a + c.minor, 0n)).toBe(t.expensesMinor);
  });

  it("hide their transactions, merchants and recurring payments from other members", async () => {
    const list = await q((tx) => listTransactions(tx, asMe(), { ...OCT, side: "spending" }));
    expect(list.rows.map((r) => r.description)).toEqual(["שופרסל"]);
    expect((await q((tx) => merchantBreakdown(tx, asMe(), "2026-10"))).map((m) => m.name)).toEqual(["שופרסל"]);
    expect((await q((tx) => largestTransactions(tx, asMe(), "2026-10"))).map((t) => t.description)).toEqual(["שופרסל"]);
    expect((await q((tx) => merchantList(tx, asMe()))).map((m) => m.name)).toEqual(["שופרסל"]);
    expect(await q((tx) => recurringSeries(tx, asMe(), "2026-10"))).toEqual([]);
    const secret = await q(async (tx) => (await tx.select().from(merchant).where(and(eq(merchant.householdId, HH), eq(merchant.name, "בוטיק סודי"))))[0]!.id);
    expect(await q((tx) => merchantDetail(tx, asMe(), secret, "2026-10"))).toBeNull();
  });

  it("show everything to the account's owner", async () => {
    const list = await q((tx) => listTransactions(tx, asPartner(), { ...OCT, side: "spending" }));
    expect(list.rows.map((r) => r.description).sort()).toEqual(["Spotify P46B9945EB", "בוטיק סודי", "שופרסל"].sort());
    expect((await q((tx) => recurringSeries(tx, asPartner(), "2026-10"))).map((s) => s.label)).toContain("Spotify P46B9945EB");
  });
});
