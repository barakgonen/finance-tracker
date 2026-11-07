// The assistant's tools: read-only, typed wrappers over @ft/analytics (the same functions the
// screens use, so answers and screens agree). The household is never a parameter: it comes from
// the signed-in session, and every call runs inside that household's row-level-security scope.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import {
  budgetsWithStatus,
  categoryBreakdown,
  forecastFrom,
  goalsWithProgress,
  healthScore,
  latestMonth,
  listTransactions,
  merchantBreakdown,
  monthlySeries,
  openInsights,
  recurringSeries,
  type Filters,
} from "@ft/analytics";
import type { Adjustment } from "@ft/core";
import { account, category, householdMember, transaction, type Db } from "@ft/db";

export interface ToolContext {
  db: Db;
  householdId: string;
  /** the member asking: other members' private accounts count in totals, but not in details */
  viewerMemberId: string;
  members: { id: string; name: string }[];
  today: string; // YYYY-MM-DD
}

/** Money for the model: shekels with agorot, as a number. */
export const ils = (minor: bigint | null | undefined) => (minor === null || minor === undefined ? null : Number(minor) / 100);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const month = z.string().regex(MONTH, "month must be YYYY-MM");
const member = z.string().nullable();

class ToolInputError extends Error {}

function scope(ctx: ToolContext, memberName: string | null): Filters {
  const base = { householdId: ctx.householdId, viewerMemberId: ctx.viewerMemberId };
  if (memberName === null) return base;
  const m = ctx.members.find((x) => x.name === memberName);
  if (!m) throw new ToolInputError(`Unknown member "${memberName}". Members: ${ctx.members.map((x) => x.name).join(", ")}`);
  return { ...base, memberId: m.id };
}

// JSON Schema helpers (strict mode: every property required, additionalProperties false)
const str = (description: string) => ({ type: "string", description });
const nstr = (description: string) => ({ type: ["string", "null"], description });
const nnum = (description: string) => ({ type: ["number", "null"], description });
const MEMBER_DESC = "A household member's name exactly as listed by get_data_overview, or null for the whole household";
const obj = (properties: Record<string, unknown>) => ({ type: "object" as const, properties, required: Object.keys(properties), additionalProperties: false });

interface ToolDef<S extends z.ZodTypeAny> {
  definition: Anthropic.Tool;
  input: S;
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<unknown>;
}
const tool = <S extends z.ZodTypeAny>(d: ToolDef<S>) => d;

export const TOOLS = [
  tool({
    definition: {
      name: "get_data_overview",
      description:
        "What data exists: today's date, household members, accounts (owner, whether card statements are imported) with the date range of their transactions, the latest month with data, and how many transactions still await review. Call this first in a conversation to know which periods can be answered.",
      input_schema: obj({}),
    },
    input: z.object({}).strict(),
    run: async (ctx) => {
      const accounts = await ctx.db
        .select({
          name: account.name,
          type: account.type,
          owner: householdMember.displayName,
          tracksStatements: account.tracksStatements,
          first: sql<string | null>`min(${transaction.purchaseDate})::text`,
          last: sql<string | null>`max(${transaction.purchaseDate})::text`,
          count: sql<number>`count(${transaction.id})::int`,
        })
        .from(account)
        .leftJoin(householdMember, eq(householdMember.id, account.ownerMemberId))
        .leftJoin(transaction, eq(transaction.accountId, account.id))
        .where(eq(account.householdId, ctx.householdId))
        .groupBy(account.id, account.name, account.type, householdMember.displayName, account.tracksStatements);
      const [review] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(transaction)
        .where(and(eq(transaction.householdId, ctx.householdId), eq(transaction.needsReview, true)));
      return {
        today: ctx.today,
        currency: "ILS",
        members: ctx.members.map((m) => m.name),
        latest_month_with_data: await latestMonth(ctx.db, ctx.householdId),
        transactions_awaiting_review: review?.n ?? 0,
        accounts: accounts.map((a) => ({
          name: a.name,
          type: a.type,
          owner: a.owner ?? "shared",
          statements_imported: a.type !== "credit_card" || a.tracksStatements,
          transactions: a.count,
          first_date: a.first,
          last_date: a.last,
        })),
      };
    },
  }),
  tool({
    definition: {
      name: "list_categories",
      description: "All spending and income categories (slug, Hebrew and English name). Use the slug in other tools.",
      input_schema: obj({}),
    },
    input: z.object({}).strict(),
    run: async (ctx) =>
      (await ctx.db.select({ slug: category.slug, he: category.nameHe, en: category.nameEn, type: category.type }).from(category).where(eq(category.householdId, ctx.householdId))).map(
        (c) => ({ slug: c.slug, name_he: c.he, name_en: c.en, type: c.type }),
      ),
  }),
  tool({
    definition: {
      name: "get_monthly_totals",
      description:
        "Income, spending and net per month for a range of up to 24 months. Spending excludes card bill payments, transfers and savings; refunds reduce it. 'unreviewed_*' is the part based on automatic guesses the user hasn't confirmed.",
      input_schema: obj({ from_month: str("YYYY-MM"), to_month: str("YYYY-MM"), member: nstr(MEMBER_DESC) }),
    },
    input: z.object({ from_month: month, to_month: month, member }).strict(),
    run: async (ctx, i) => {
      if (i.from_month > i.to_month) throw new ToolInputError("from_month is after to_month");
      const [fy, fm] = i.from_month.split("-").map(Number) as [number, number];
      const [ty, tm] = i.to_month.split("-").map(Number) as [number, number];
      if ((ty - fy) * 12 + tm - fm > 23) throw new ToolInputError("At most 24 months per call");
      const s = await monthlySeries(ctx.db, scope(ctx, i.member), i.from_month, i.to_month);
      return s.map((m) => ({
        month: m.month,
        income: ils(m.incomeMinor),
        spending: ils(m.expensesMinor),
        net: ils(m.netMinor),
        unreviewed_income: ils(m.unreviewedIncomeMinor),
        unreviewed_spending: ils(m.unreviewedExpensesMinor),
        transactions: m.transactionCount,
      }));
    },
  }),
  tool({
    definition: {
      name: "get_category_breakdown",
      description: "Spending (or income) by category for one month, with the previous month and the average of the three months before it (null when there is no history).",
      input_schema: obj({ month: str("YYYY-MM"), side: { type: "string", enum: ["spending", "income"] }, member: nstr(MEMBER_DESC) }),
    },
    input: z.object({ month, side: z.enum(["spending", "income"]), member }).strict(),
    run: async (ctx, i) =>
      (await categoryBreakdown(ctx.db, scope(ctx, i.member), i.month, i.side)).map((c) => ({
        slug: c.slug,
        name: c.nameHe,
        amount: ils(c.minor),
        share_of_month: Math.round(c.share * 1000) / 1000,
        transactions: c.count,
        previous_month: ils(c.prevMinor),
        average_prior_3_months: ils(c.avg3Minor),
      })),
  }),
  tool({
    definition: {
      name: "get_top_merchants",
      description: "The merchants with the most spending in a month: amount, number of transactions, average per transaction, and last month's spending there.",
      input_schema: obj({ month: str("YYYY-MM"), limit: nnum("1-20, default 10"), member: nstr(MEMBER_DESC) }),
    },
    input: z.object({ month, limit: z.number().int().min(1).max(20).nullable(), member }).strict(),
    run: async (ctx, i) =>
      (await merchantBreakdown(ctx.db, scope(ctx, i.member), i.month, i.limit ?? 10)).map((m) => ({
        merchant: m.name,
        amount: ils(m.minor),
        transactions: m.count,
        average: ils(m.avgMinor),
        previous_month: ils(m.prevMinor),
      })),
  }),
  tool({
    definition: {
      name: "search_transactions",
      description:
        "Transactions in a date range, optionally filtered by side, category and description text, with the count and the total of ALL matching rows (not just the rows returned). Use the total for questions like 'how much did we spend on X over the last N months'. Amounts are signed: negative = money out.",
      input_schema: obj({
        from_date: str("YYYY-MM-DD, inclusive"),
        to_date: str("YYYY-MM-DD, exclusive"),
        side: { type: "string", enum: ["spending", "income", "all"] },
        category_slug: nstr("A slug from list_categories, 'uncategorized', or null"),
        text: nstr("Text to look for in the description (e.g. a merchant name), or null"),
        member: nstr(MEMBER_DESC),
        limit: nnum("Rows to return, 1-50, default 20"),
      }),
    },
    input: z
      .object({
        from_date: z.string().regex(DATE),
        to_date: z.string().regex(DATE),
        side: z.enum(["spending", "income", "all"]),
        category_slug: z.string().nullable(),
        text: z.string().max(100).nullable(),
        member,
        limit: z.number().int().min(1).max(50).nullable(),
      })
      .strict(),
    run: async (ctx, i) => {
      if (i.from_date >= i.to_date) throw new ToolInputError("from_date must be before to_date");
      const r = await listTransactions(ctx.db, scope(ctx, i.member), {
        from: i.from_date,
        to: i.to_date,
        side: i.side,
        category: i.category_slug ?? undefined,
        search: i.text ?? undefined,
        limit: i.limit ?? 20,
      });
      return {
        matching_transactions: r.count,
        total: ils(r.totalMinor),
        returned: r.rows.length,
        rows: r.rows.map((t) => ({
          id: t.id,
          date: t.purchaseDate,
          description: t.description,
          amount: ils(t.amount),
          category: t.categoryNameHe,
          account: t.accountName,
          needs_review: t.needsReview,
          ...(t.installmentNo ? { installment: `${t.installmentNo}/${t.installmentTotal}` } : {}),
        })),
      };
    },
  }),
  tool({
    definition: {
      name: "get_recurring",
      description: "Recurring payments, installment plans and recurring income detected up to a month (needs 3+ regular occurrences), with monthly/annual cost and the next expected date.",
      input_schema: obj({ month: str("YYYY-MM"), member: nstr(MEMBER_DESC) }),
    },
    input: z.object({ month, member }).strict(),
    run: async (ctx, i) =>
      (await recurringSeries(ctx.db, scope(ctx, i.member), i.month)).map((s) => ({
        name: s.label,
        direction: s.direction,
        cadence: s.cadence,
        typical_amount: ils(s.amountMinor),
        monthly: ils(s.monthlyMinor),
        annual: ils(s.annualMinor),
        active: s.active,
        next_date: s.active ? s.nextDate : null,
        category: s.categoryName,
        confidence: s.confidence,
        ...(s.installments ? { installments: s.installments } : {}),
        ...(s.previousTypicalMinor !== null && s.lastAmountMinor !== s.previousTypicalMinor ? { last_amount: ils(s.lastAmountMinor), previous_typical: ils(s.previousTypicalMinor) } : {}),
      })),
  }),
  tool({
    definition: {
      name: "get_budgets_and_goals",
      description: "Budgets with the month's spending and state, and goals with their progress, for the household (member null) or one member.",
      input_schema: obj({ month: str("YYYY-MM"), member: nstr(MEMBER_DESC) }),
    },
    input: z.object({ month, member }).strict(),
    run: async (ctx, i) => {
      const f = scope(ctx, i.member);
      return {
        budgets: (await budgetsWithStatus(ctx.db, f, i.month)).map((b) => ({
          category: b.categoryName,
          limit: ils(b.status.limitMinor),
          spent: ils(b.status.spentMinor),
          projected_month_end: ils(b.status.projectedMinor),
          state: b.status.state,
        })),
        goals: (await goalsWithProgress(ctx.db, f, i.month)).map((g) => ({
          name: g.goal.name,
          type: g.goal.type,
          progress: Math.round(g.progress.progress * 100) / 100,
          state: g.progress.state,
          ...(g.progress.savedMinor !== undefined ? { saved: ils(g.progress.savedMinor), target: ils(g.goal.targetAmount), required_monthly: ils(g.progress.requiredMonthlyMinor ?? null), deadline: g.goal.deadline } : {}),
          ...(g.progress.currentRate !== undefined ? { current_rate: Math.round(g.progress.currentRate * 1000) / 1000, target_rate: g.goal.targetRate } : {}),
          ...(g.progress.targetMonthlyMinor !== undefined ? { category: g.categoryName, target_monthly: ils(g.progress.targetMonthlyMinor), this_month: ils(g.progress.currentMonthlyMinor) } : {}),
        })),
      };
    },
  }),
  tool({
    definition: {
      name: "get_forecast",
      description:
        "Forecast for the months after `month` (needs 3 complete months of history; otherwise status 'insufficient'), optionally with a what-if scenario. Returns the baseline and, when any scenario field is set, the scenario: monthly income/spending/net and the projected balance (or cumulative net when no bank balance is known), each with a low-high range. Use it for affordability questions (one_off_purchase).",
      input_schema: obj({
        month: str("YYYY-MM: the last month of history"),
        horizon: { type: "integer", enum: [3, 6, 12] },
        spend_less_monthly: nnum("Spend this much less each month (ILS), or null"),
        income_change_pct: nnum("Income change in percent (10 = +10%), or null"),
        new_monthly_payment: nnum("A new monthly payment (ILS), or null"),
        new_payment_months: nnum("For how many months, or null for the whole horizon"),
        extra_saving_monthly: nnum("Move this much to savings each month (ILS), or null"),
        one_off_purchase: nnum("A one-off purchase (ILS), or null"),
        one_off_month_index: nnum("Forecast month of the purchase, 0 = first, or null"),
      }),
    },
    input: z
      .object({
        month,
        horizon: z.union([z.literal(3), z.literal(6), z.literal(12)]),
        spend_less_monthly: z.number().min(0).nullable(),
        income_change_pct: z.number().min(-100).max(100).nullable(),
        new_monthly_payment: z.number().min(0).nullable(),
        new_payment_months: z.number().int().min(1).nullable(),
        extra_saving_monthly: z.number().min(0).nullable(),
        one_off_purchase: z.number().min(0).nullable(),
        one_off_month_index: z.number().int().min(0).nullable(),
      })
      .strict(),
    run: async (ctx, i) => {
      const toMinor = (v: number) => BigInt(Math.round(v * 100));
      const adj: Adjustment[] = [];
      if (i.spend_less_monthly) adj.push({ kind: "expense_change", monthlyMinor: -toMinor(i.spend_less_monthly) });
      if (i.income_change_pct) adj.push({ kind: "income_change", pct: i.income_change_pct / 100 });
      if (i.new_monthly_payment) adj.push({ kind: "new_payment", monthlyMinor: toMinor(i.new_monthly_payment), months: i.new_payment_months ?? undefined });
      if (i.extra_saving_monthly) adj.push({ kind: "extra_saving", monthlyMinor: toMinor(i.extra_saving_monthly) });
      if (i.one_off_purchase) adj.push({ kind: "one_off", amountMinor: toMinor(i.one_off_purchase), monthIndex: Math.min(i.horizon - 1, i.one_off_month_index ?? 0) });
      const f = { householdId: ctx.householdId, viewerMemberId: ctx.viewerMemberId };
      const view = async (a: Adjustment[]) => {
        const r = await forecastFrom(ctx.db, f, i.month, i.horizon, a);
        if (r.status === "insufficient") return { status: "insufficient", complete_months_of_history: r.historyMonths, needed: 3 };
        const range = (x: { low: bigint; mid: bigint; high: bigint }) => ({ low: ils(x.low), expected: ils(x.mid), high: ils(x.high) });
        return {
          status: "ok",
          history_months: r.historyMonths,
          assumptions: {
            monthly_income: ils(r.assumptions.incomeMinor),
            fixed_payments: ils(r.assumptions.fixedPaymentsMinor),
            typical_variable_spending: ils(r.assumptions.variableSpendingMinor),
            installments_ending: r.assumptions.endingInstallments,
            seasonality: false,
          },
          months: r.months.map((m) => ({
            month: m.month,
            income: ils(m.income.mid),
            spending: ils(m.expenses.mid),
            net: range(m.net),
            ...(m.balance ? { balance: range(m.balance) } : { cumulative_net: range(m.cumulative) }),
            ...(m.extraSavedMinor > 0n ? { moved_to_savings: ils(m.extraSavedMinor) } : {}),
          })),
        };
      };
      return { baseline: await view([]), ...(adj.length ? { scenario: await view(adj) } : {}) };
    },
  }),
  tool({
    definition: {
      name: "get_health_score",
      description: "The financial health score (0-100, or null with the reason when data is insufficient) with each dimension's score and measured value, confidence, and the weakest dimensions.",
      input_schema: obj({ month: str("YYYY-MM"), member: nstr(MEMBER_DESC) }),
    },
    input: z.object({ month, member }).strict(),
    run: async (ctx, i) => {
      const r = await healthScore(ctx.db, scope(ctx, i.member), i.month);
      return {
        total: r.total,
        insufficient_reason: r.insufficient ?? null,
        complete_months: r.monthsUsed,
        confidence: r.confidence,
        unreviewed_share: Math.round(r.unreviewedShare * 100) / 100,
        dimensions: r.dimensions.map((d) => ({ key: d.key, score: d.score, value: d.value === null ? null : Math.round(d.value * 1000) / 1000, missing: d.missing ?? null })),
        weakest: r.focus,
      };
    },
  }),
  tool({
    definition: {
      name: "get_insights",
      description: "The month's open findings (category spikes, subscriptions, price increases, possible duplicate charges, unusual purchases, savings drops), each with its numbers, monthly or one-off impact, confidence and evidence transaction ids. Findings the household already marked handled or not relevant are left out (only counted).",
      input_schema: obj({ month: str("YYYY-MM"), member: nstr(MEMBER_DESC) }),
    },
    input: z.object({ month, member }).strict(),
    run: async (ctx, i) => {
      const { open, handled } = await openInsights(ctx.db, scope(ctx, i.member), i.month);
      return { already_handled: handled.length, open: open.map((x) => ({
        finding: x.detector,
        details: Object.fromEntries(Object.entries(x.params).map(([k, v]) => [k, typeof v === "number" && ["current", "average", "monthly", "annual", "before", "now", "amount", "typical"].includes(k) ? v / 100 : v])),
        monthly_impact: ils(x.monthlyImpactMinor),
        one_off: ils(x.oneOffMinor),
        confidence: x.confidence,
        evidence_transaction_ids: x.evidence.slice(0, 10),
      })) };
    },
  }),
];

export const TOOL_DEFINITIONS: Anthropic.Tool[] = TOOLS.map((t) => ({ ...t.definition, strict: true }));

export interface ToolOutcome {
  ok: boolean;
  content: string;
}

/** Validates and runs one tool call. Bad input comes back as an error result Claude can correct. */
export async function runTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolOutcome> {
  const t = TOOLS.find((x) => x.definition.name === name);
  if (!t) return { ok: false, content: `Unknown tool: ${name}` };
  const parsed = t.input.safeParse(input);
  if (!parsed.success) return { ok: false, content: `Invalid input: ${parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}` };
  try {
    const result = await t.run(ctx, parsed.data as never);
    return { ok: true, content: JSON.stringify(result) };
  } catch (e) {
    if (e instanceof ToolInputError) return { ok: false, content: e.message };
    throw e;
  }
}
