// The question-answering loop: Claude calls the read-only tools until it can answer. Every turn is
// stored exactly as sent/received (append-only), so the conversation replays faithfully and every
// answer can be audited against the tool results it was based on.
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, sql } from "drizzle-orm";
import { assistantConversation, assistantMessage, type Db } from "@ft/db";
import { SYSTEM_PROMPT } from "./prompt.js";
import { runTool, TOOL_DEFINITIONS, type ToolContext } from "./tools.js";
import { verifyAnswer, type Verification } from "./verify.js";

export const MODEL = "claude-opus-5-5";
const MAX_ROUNDS = 8;

/** The part of the SDK client the loop uses (lets tests script the model's responses). */
export interface ModelClient {
  beta: { messages: { create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage> } };
}

export interface AskInput {
  question: string;
  conversationId?: string | null;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  ok: boolean;
}

export interface AskResult {
  conversationId: string;
  answer: string;
  outcome: "answered" | "refused" | "truncated" | "too_many_steps";
  toolCalls: ToolCallRecord[];
  verification: Verification;
}

export class AssistantError extends Error {
  constructor(
    readonly code: "rate_limited" | "auth" | "unavailable" | "bad_request",
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES = {
  refused: "לא יכולתי לענות על השאלה הזו. אפשר לנסח אותה אחרת או לשאול על נתון מסוים.",
  truncated: "התשובה נקטעה לפני שהושלמה. כדאי לשאול שאלה ממוקדת יותר.",
  tooManySteps: "השאלה דרשה יותר מדי שלבים. כדאי לפצל אותה לכמה שאלות קצרות יותר.",
};

/** Asks one question in a (new or existing) conversation of the member, within a household-scoped transaction. */
export async function ask(client: ModelClient, ctx: Omit<ToolContext, "viewerMemberId"> & { memberId: string }, input: AskInput): Promise<AskResult> {
  const { db, householdId } = ctx;
  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const [c] = await db
      .select({ id: assistantConversation.id })
      .from(assistantConversation)
      .where(and(eq(assistantConversation.id, conversationId), eq(assistantConversation.memberId, ctx.memberId)));
    if (!c) conversationId = null;
  }
  if (!conversationId) {
    const [c] = await db
      .insert(assistantConversation)
      .values({ householdId, memberId: ctx.memberId, title: input.question.trim().slice(0, 80) })
      .returning({ id: assistantConversation.id });
    conversationId = c!.id;
  }

  const history = await db.select().from(assistantMessage).where(eq(assistantMessage.conversationId, conversationId)).orderBy(asc(assistantMessage.seq));
  // stored exactly as the API produced/accepted them, so they replay as-is
  const messages = history.map((m) => ({ role: m.role, content: m.content }) as Anthropic.Beta.BetaMessageParam);
  let seq = history.length;
  const store = async (row: { role: "user" | "assistant"; content: unknown; visible?: boolean; displayText?: string; toolCalls?: unknown; verification?: unknown; usage?: unknown }) => {
    await db.insert(assistantMessage).values({ householdId, conversationId: conversationId!, seq: seq++, ...row });
  };

  const question: Anthropic.Beta.BetaMessageParam = { role: "user", content: [{ type: "text", text: input.question.trim() }] };
  messages.push(question);
  await store({ role: "user", content: question.content, visible: true, displayText: input.question.trim() });

  const toolCalls: ToolCallRecord[] = [];
  const toolResults: string[] = [];
  const finish = async (answer: string, outcome: AskResult["outcome"], content: unknown, usage: unknown): Promise<AskResult> => {
    const verification = outcome === "answered" ? verifyAnswer(answer, toolResults) : { checked: 0, untraced: [] };
    await store({ role: "assistant", content, visible: true, displayText: answer, toolCalls, verification, usage });
    await db.update(assistantConversation).set({ updatedAt: new Date() }).where(eq(assistantConversation.id, conversationId!));
    return { conversationId: conversationId!, answer, outcome, toolCalls, verification };
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS,
        messages,
        // the system prompt, tools and growing history are a stable prefix: cache it
        cache_control: { type: "ephemeral" },
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        // a safety decline is retried server-side on Anthropic's recommended model for that category
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new AssistantError("rate_limited", "Rate limited");
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AssistantError("auth", "API key rejected");
      if (e instanceof Anthropic.BadRequestError) throw new AssistantError("bad_request", e.message);
      if (e instanceof Anthropic.APIError) throw new AssistantError("unavailable", e.message);
      throw e;
    }
    // keep the response exactly as returned (thinking and fallback blocks included) for replay
    const content = response.content as unknown as Anthropic.Beta.BetaContentBlockParam[];
    messages.push({ role: "assistant", content });
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n\n")
      .trim();

    // never run tools from a declined or cut-off turn
    if (response.stop_reason === "refusal") return finish(MESSAGES.refused, "refused", content, response.usage);
    if (response.stop_reason === "max_tokens") return finish(text ? `${text}\n\n${MESSAGES.truncated}` : MESSAGES.truncated, "truncated", content, response.usage);

    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason === "tool_use" && uses.length > 0) {
      await store({ role: "assistant", content, usage: response.usage });
      // run them in order on the request's transaction; return all results in one message
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        const outcome = await runTool({ ...ctx, viewerMemberId: ctx.memberId }, u.name, u.input);
        toolCalls.push({ id: u.id, name: u.name, input: u.input, ok: outcome.ok });
        if (outcome.ok) toolResults.push(outcome.content);
        results.push({ type: "tool_result", tool_use_id: u.id, content: outcome.content, ...(outcome.ok ? {} : { is_error: true }) });
      }
      messages.push({ role: "user", content: results });
      await store({ role: "user", content: results });
      continue;
    }
    if (response.stop_reason === "pause_turn") {
      await store({ role: "assistant", content, usage: response.usage });
      continue;
    }
    return finish(text, "answered", content, response.usage);
  }
  return finish(MESSAGES.tooManySteps, "too_many_steps", [{ type: "text", text: MESSAGES.tooManySteps }], null);
}

/** The visible messages of a conversation (questions and answers). */
export async function conversationMessages(db: Db, conversationId: string) {
  return db
    .select({
      id: assistantMessage.id,
      role: assistantMessage.role,
      text: assistantMessage.displayText,
      toolCalls: assistantMessage.toolCalls,
      verification: assistantMessage.verification,
      createdAt: assistantMessage.createdAt,
    })
    .from(assistantMessage)
    .where(and(eq(assistantMessage.conversationId, conversationId), eq(assistantMessage.visible, true)))
    .orderBy(asc(assistantMessage.seq));
}

/** A member's conversations, newest first. */
export async function conversationsOf(db: Db, memberId: string) {
  return db
    .select({ id: assistantConversation.id, title: assistantConversation.title, updatedAt: assistantConversation.updatedAt })
    .from(assistantConversation)
    .where(eq(assistantConversation.memberId, memberId))
    .orderBy(sql`${assistantConversation.updatedAt} desc`)
    .limit(50);
}
