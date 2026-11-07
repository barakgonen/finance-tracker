// The tool loop and tools against a real database as the restricted role, with Claude replaced by
// a scripted client (no API calls). Checks request shape, tool validation and scoping, refusal
// handling, persistence and replay, the round cap, and number tracing.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { assistantMessage, scoped, type Db } from "@ft/db";
import { listTransactions } from "@ft/analytics";
import { addAccount, commitImport, createHousehold, stageStatement } from "@ft/ingest";
import type { ParsedStatement } from "@ft/parsers";
import { bankStatement, cardStatement, fileFor, row, startHarness, type Harness } from "../../ingest/test/harness.js";
import { ask, conversationMessages, conversationsOf, MODEL, runTool, TOOL_DEFINITIONS, type ModelClient, type ToolContext } from "../src/index.js";

let h: Harness;
const HH = randomUUID();
let ctxBase: Omit<ToolContext, "db"> & { memberId: string };
let partnerId: string;
const q = <T>(fn: (tx: Db) => Promise<T>) => scoped(h.appDb, { householdId: HH }, fn);

beforeAll(async () => {
  h = await startHarness();
  const ids = await q(async (tx) => {
    const { members } = await createHousehold(tx, "t", [{ displayName: "דנה", role: "admin" }, { displayName: "יואב" }], HH);
    const bank = await addAccount(tx, HH, { type: "bank", institution: "leumi", name: "בנק" });
    const card = await addAccount(tx, HH, { type: "credit_card", institution: "cal", name: "כרטיס", numberLast4: "1111", ownerMemberId: members[0]!.id });
    return { members, bank: bank.id, card: card.id };
  });
  partnerId = ids.members[1]!.id;
  ctxBase = { householdId: HH, members: ids.members.map((m) => ({ id: m.id, name: m.displayName })), today: "2026-11-06", memberId: ids.members[0]!.id };
  const load = (s: ParsedStatement, accountId: string) =>
    q(async (tx) => {
      const deps = { db: tx, blobs: h.deps.blobs };
      const p = await stageStatement(deps, { householdId: HH, file: fileFor(s), statement: s, accountId });
      await commitImport(deps, { householdId: HH, importId: p.importId });
    });
  await load(cardStatement("cal", "1111", "2026-10-28", [row("2026-10-03", "שופרסל", -300000), row("2026-10-05", "WOLT", -12000), row("2026-10-09", "WOLT", -8000)]), ids.card);
  await load(bankStatement([row("2026-10-01", "משכורת", 1500000)]), ids.bank);
});
afterAll(() => h?.stop());

/** A fake model: replies are produced by `script` from the request; every request is recorded. */
function fakeClient(script: (params: Anthropic.Beta.MessageCreateParamsNonStreaming, call: number) => Partial<Anthropic.Beta.BetaMessage>) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const client: ModelClient = {
    beta: {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params));
          const r = script(params, requests.length - 1);
          return { id: `msg_${requests.length}`, type: "message", role: "assistant", model: MODEL, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [], ...r } as Anthropic.Beta.BetaMessage;
        },
      },
    },
  };
  return { client, requests };
}
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as unknown as Anthropic.Beta.BetaContentBlock;
const text = (t: string) => ({ type: "text", text: t }) as unknown as Anthropic.Beta.BetaContentBlock;

describe("tools", () => {
  it("are strict, with every property required and no extras", () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.strict, t.name).toBe(true);
      const schema = t.input_schema as { properties: object; required: string[]; additionalProperties: boolean };
      expect(schema.additionalProperties, t.name).toBe(false);
      expect(schema.required.sort(), t.name).toEqual(Object.keys(schema.properties).sort());
    }
  });

  it("validate input and report problems back instead of running", async () => {
    await q(async (db) => {
      const ctx = { ...ctxBase, db };
      expect(await runTool(ctx, "get_category_breakdown", { month: "10/2026", side: "spending", member: null })).toMatchObject({ ok: false, content: expect.stringContaining("YYYY-MM") });
      expect(await runTool(ctx, "get_category_breakdown", { month: "2026-10", side: "spending", member: "מישהו" })).toMatchObject({ ok: false, content: expect.stringContaining("Unknown member") });
      expect(await runTool(ctx, "drop_tables", {})).toMatchObject({ ok: false });
      expect(await runTool(ctx, "search_transactions", { from_date: "2026-10-01", to_date: "2026-11-01", side: "spending", category_slug: null, text: null, member: null, limit: 500 })).toMatchObject({ ok: false });
    });
  });

  it("report totals that match the screens' drill-down", async () => {
    await q(async (db) => {
      const r = await runTool({ ...ctxBase, db }, "search_transactions", { from_date: "2026-10-01", to_date: "2026-11-01", side: "spending", category_slug: "delivery", text: null, member: null, limit: 1 });
      const parsed = JSON.parse(r.content);
      const list = await listTransactions(db, { householdId: HH }, { from: "2026-10-01", to: "2026-11-01", side: "spending", category: "delivery" });
      expect(parsed).toMatchObject({ matching_transactions: 2, returned: 1, total: Number(list.totalMinor) / 100 });
      expect(parsed.total).toBe(-200);
    });
  });

  it("scope to one member by name", async () => {
    await q(async (db) => {
      const r = JSON.parse((await runTool({ ...ctxBase, db }, "get_monthly_totals", { from_month: "2026-10", to_month: "2026-10", member: "יואב" })).content);
      expect(r[0]).toMatchObject({ spending: 0, income: 0 });
    });
  });
});

describe("ask", () => {
  it("runs tools, stores every turn, sends the documented request shape, and traces the numbers", async () => {
    const { client, requests } = fakeClient((params, call) =>
      call === 0
        ? { stop_reason: "tool_use", content: [text("בודק"), toolUse("t1", "get_data_overview", {}), toolUse("t2", "get_category_breakdown", { month: "2026-10", side: "spending", member: null }), toolUse("t3", "get_top_merchants", { month: "bad", limit: null, member: null })] }
        : { stop_reason: "end_turn", content: [text("עובדה: באוקטובר הוצאתם ₪3,000 בסופר ו-₪200 על משלוחים.")] },
    );
    const r = await q((db) => ask(client, { ...ctxBase, db }, { question: "כמה הוצאנו באוקטובר על אוכל?" }));
    expect(r).toMatchObject({ outcome: "answered", verification: { checked: 2, untraced: [] } });
    expect(r.toolCalls.map((t) => [t.name, t.ok])).toEqual([["get_data_overview", true], ["get_category_breakdown", true], ["get_top_merchants", false]]);

    const first = requests[0]!;
    expect(first).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
    expect(first.tool_choice).toBeUndefined(); // forced tool use is rejected by this model
    // all tool results go back in one user message; the invalid call as an error result
    const results = requests[1]!.messages[2]!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.map((x) => [x.tool_use_id, x.is_error ?? false])).toEqual([["t1", false], ["t2", false], ["t3", true]]);

    const rows = await q((db) => db.select().from(assistantMessage).where(eq(assistantMessage.conversationId, r.conversationId)));
    expect(rows.map((x) => [x.role, x.visible])).toEqual([["user", true], ["assistant", false], ["user", false], ["assistant", true]]);
  });

  it("flags a number the data doesn't contain", async () => {
    const { client } = fakeClient((_, call) =>
      call === 0
        ? { stop_reason: "tool_use", content: [toolUse("t1", "get_category_breakdown", { month: "2026-10", side: "spending", member: null })] }
        : { stop_reason: "end_turn", content: [text("עובדה: הוצאתם ₪4,750 בסופר.")] },
    );
    const r = await q((db) => ask(client, { ...ctxBase, db }, { question: "סופר?" }));
    expect(r.verification.untraced).toEqual(["4,750"]);
  });

  it("never runs the tools of a declined turn", async () => {
    const { client, requests } = fakeClient(() => ({ stop_reason: "refusal", content: [toolUse("t1", "get_data_overview", {})] }));
    const r = await q((db) => ask(client, { ...ctxBase, db }, { question: "?" }));
    expect(r).toMatchObject({ outcome: "refused", toolCalls: [] });
    expect(requests).toHaveLength(1);
  });

  it("continues a conversation by replaying it, and keeps it private to the member", async () => {
    const { client, requests } = fakeClient(() => ({ stop_reason: "end_turn", content: [text("עובדה: תשובה.")] }));
    const first = await q((db) => ask(client, { ...ctxBase, db }, { question: "שאלה ראשונה" }));
    await q((db) => ask(client, { ...ctxBase, db }, { question: "שאלה שנייה", conversationId: first.conversationId }));
    expect(requests[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect((await q((db) => conversationMessages(db, first.conversationId))).map((m) => m.text)).toEqual(["שאלה ראשונה", "עובדה: תשובה.", "שאלה שנייה", "עובדה: תשובה."]);
    // another member can't continue it: a new conversation starts instead
    const other = await q((db) => ask(client, { ...ctxBase, memberId: partnerId, db }, { question: "x", conversationId: first.conversationId }));
    expect(other.conversationId).not.toBe(first.conversationId);
    expect((await q((db) => conversationsOf(db, partnerId))).map((c) => c.id)).toEqual([other.conversationId]);
  });

  it("stops after a bounded number of tool rounds", async () => {
    const { client, requests } = fakeClient((_, call) => ({ stop_reason: "tool_use", content: [toolUse(`t${call}`, "list_categories", {})] }));
    const r = await q((db) => ask(client, { ...ctxBase, db }, { question: "לולאה" }));
    expect(r.outcome).toBe("too_many_steps");
    expect(requests).toHaveLength(8);
  });
});
