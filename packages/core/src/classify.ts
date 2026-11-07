// Decides a transaction's kind and category. Steps run in precedence order and the first
// confident answer wins; every result says where it came from so the UI can explain it.
import { INCOME_KINDS, type TransactionKind } from "./kinds.js";
import { normalizeDescription, similarity } from "./merchant.js";
import { SYSTEM_CATEGORIES } from "./categories.js";
import { BANK_ENTRIES, ISSUER_CATEGORY_MAP, MERCHANT_ENTRIES, TYPE_HINT_KINDS, type DictionaryEntry } from "./dictionary.js";

export interface ClassifyInput {
  description: string;
  /** Signed: negative = money out. */
  amountMinor: bigint;
  accountType: "bank" | "credit_card";
  accountId?: string;
  /** Issuer's own category label (ענף / קטגוריה). */
  categoryHint?: string;
  /** Issuer's transaction-type label ("זיכוי", "הוראת קבע", ...). */
  typeHint?: string;
}

export type ClassificationSource = "rule" | "merchant" | "dictionary" | "neighbour" | "none";

export interface Classification {
  kind: TransactionKind;
  category: string | null;
  source: ClassificationSource;
  confidence: number;
  /** Short, human-readable explanation ("rule: מכולת", "issuer label מסעדות/קפה"). */
  reason: string;
  ruleId?: string;
  needsReview: boolean;
}

export interface RuleConditions {
  /** Normalized description key (see normalizeDescription), exact match. */
  merchantKey?: string;
  descriptionRegex?: string;
  accountId?: string;
  direction?: "in" | "out";
  /** Inclusive bounds on the absolute amount, minor units. */
  minAbsMinor?: string;
  maxAbsMinor?: string;
}

export interface RuleActions {
  kind?: TransactionKind;
  category?: string;
}

export interface Rule {
  id: string;
  priority: number; // lower runs first
  conditions: RuleConditions;
  actions: RuleActions;
}

export interface LabeledExample {
  /** normalized description key */
  key: string;
  kind: TransactionKind;
  category: string | null;
}

export interface ClassifierContext {
  rules?: Rule[];
  /** merchant key -> category/kind assigned to that merchant */
  merchants?: Map<string, RuleActions>;
  /** previously corrected/confirmed transactions, for nearest-neighbour suggestions */
  examples?: LabeledExample[];
  /** below this, the transaction goes to the review queue */
  reviewThreshold?: number;
}

export const DEFAULT_REVIEW_THRESHOLD = 0.7;
const EXPENSE_CATEGORIES = new Set(SYSTEM_CATEGORIES.filter((c) => c.type === "expense").map((c) => c.slug));
const INCOME_CATEGORIES = new Set(SYSTEM_CATEGORIES.filter((c) => c.type === "income").map((c) => c.slug));
const NEIGHBOUR_MIN_SIMILARITY = 0.6;

export function ruleMatches(rule: Rule, input: ClassifyInput, key: string): boolean {
  const c = rule.conditions;
  const abs = input.amountMinor < 0n ? -input.amountMinor : input.amountMinor;
  if (c.merchantKey !== undefined && c.merchantKey !== key) return false;
  if (c.descriptionRegex !== undefined && !new RegExp(c.descriptionRegex, "iu").test(input.description)) return false;
  if (c.accountId !== undefined && c.accountId !== input.accountId) return false;
  if (c.direction !== undefined && c.direction !== direction(input)) return false;
  if (c.minAbsMinor !== undefined && abs < BigInt(c.minAbsMinor)) return false;
  if (c.maxAbsMinor !== undefined && abs > BigInt(c.maxAbsMinor)) return false;
  return true;
}

function direction(input: ClassifyInput): "in" | "out" {
  return input.amountMinor < 0n ? "out" : "in";
}

/**
 * Income is money coming in: a learned answer (rule, merchant, similar transaction) that would
 * make outgoing money income, or file it under an income category, doesn't apply to it.
 */
export function fitsDirection(amountMinor: bigint, kind: TransactionKind | undefined, category: string | null | undefined): boolean {
  if (amountMinor >= 0n) return true;
  return !(kind && INCOME_KINDS.has(kind)) && !(category && INCOME_CATEGORIES.has(category));
}

/** The kind implied by the money's direction when nothing more specific is known. */
function defaultKind(input: ClassifyInput): TransactionKind {
  if (direction(input) === "out") return "expense";
  return input.accountType === "credit_card" ? "refund" : "income";
}

function dictionaryMatch(entries: DictionaryEntry[], input: ClassifyInput): DictionaryEntry | undefined {
  const dir = direction(input);
  return entries.find(
    (e) =>
      (!e.direction || e.direction === dir) &&
      (!e.account || e.account === input.accountType) &&
      e.pattern.test(input.description),
  );
}

export function classify(input: ClassifyInput, ctx: ClassifierContext = {}): Classification {
  const threshold = ctx.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD;
  const key = normalizeDescription(input.description).key;
  const done = (c: Omit<Classification, "needsReview">): Classification => ({ ...c, needsReview: c.confidence < threshold });

  // 1. user rules
  for (const rule of [...(ctx.rules ?? [])].sort((a, b) => a.priority - b.priority)) {
    if (!ruleMatches(rule, input, key) || !fitsDirection(input.amountMinor, rule.actions.kind, rule.actions.category)) continue;
    return done({
      kind: rule.actions.kind ?? defaultKind(input),
      category: rule.actions.category ?? null,
      source: "rule",
      confidence: 1,
      reason: `rule ${rule.id}`,
      ruleId: rule.id,
    });
  }

  // 2. merchant the user already categorized
  const merchant = ctx.merchants?.get(key);
  if (merchant && fitsDirection(input.amountMinor, merchant.kind, merchant.category)) {
    return done({
      kind: merchant.kind ?? defaultKind(input),
      category: merchant.category ?? null,
      source: "merchant",
      confidence: 0.95,
      reason: `merchant "${key}"`,
    });
  }

  // 3. built-in knowledge: bank movement patterns, merchant names, issuer labels
  const typeKind = input.typeHint ? TYPE_HINT_KINDS[input.typeHint] : undefined;
  const bankEntry = input.accountType === "bank" ? dictionaryMatch(BANK_ENTRIES, input) : undefined;
  const merchantEntry = dictionaryMatch(MERCHANT_ENTRIES, input);
  const hintCategory = input.categoryHint ? ISSUER_CATEGORY_MAP[input.categoryHint] : undefined;

  if (bankEntry) {
    return done({
      kind: bankEntry.kind ?? defaultKind(input),
      category: bankEntry.category ?? merchantEntry?.category ?? null,
      source: "dictionary",
      confidence: bankEntry.confidence,
      reason: bankEntry.label,
    });
  }

  if (merchantEntry || hintCategory) {
    const category = merchantEntry?.category ?? hintCategory ?? null;
    const agree = merchantEntry?.category !== undefined && merchantEntry.category === hintCategory;
    const confidence = agree ? 0.97 : merchantEntry ? merchantEntry.confidence : 0.75;
    const reasons = [merchantEntry?.label, hintCategory && `issuer label ${input.categoryHint}`].filter(Boolean);
    // money *from* a merchant (card credit, or an insurer paying a claim into the bank) is a
    // refund that offsets that category, never income
    const isRefund = direction(input) === "in" && category !== null && EXPENSE_CATEGORIES.has(category);
    return done({
      kind: merchantEntry?.kind ?? (isRefund ? "refund" : (typeKind ?? defaultKind(input))),
      // a refund of a categorized purchase stays in that category so it offsets the spending
      category: merchantEntry?.kind && merchantEntry.kind !== "expense" ? null : category,
      source: "dictionary",
      confidence,
      reason: reasons.join(" + "),
    });
  }

  // 4. nearest neighbour over the household's own corrected history
  let best: { ex: LabeledExample; score: number } | undefined;
  for (const ex of ctx.examples ?? []) {
    if (!fitsDirection(input.amountMinor, ex.kind, ex.category)) continue;
    const score = similarity(key, ex.key);
    if (score >= NEIGHBOUR_MIN_SIMILARITY && (!best || score > best.score)) best = { ex, score };
  }
  if (best) {
    return done({
      kind: best.ex.kind,
      category: best.ex.category,
      source: "neighbour",
      confidence: Math.min(0.9, best.score * 0.9),
      reason: `similar to "${best.ex.key}"`,
    });
  }

  // 5. nothing known: direction-only guess, always reviewed
  return done({
    kind: typeKind ?? defaultKind(input),
    category: null,
    source: "none",
    confidence: typeKind ? 0.5 : 0.3,
    reason: typeKind ? `issuer type ${input.typeHint}` : "unrecognized",
  });
}

/**
 * Turns a user's correction into a rule for that merchant, so it applies to past and future
 * transactions ("always categorize X as Y"). It applies to money moving the same way as the
 * corrected transaction: marking a salary deposit doesn't touch a payment to the same name.
 */
export function ruleFromCorrection(id: string, description: string, amountMinor: bigint, actions: RuleActions, priority = 100): Rule {
  return { id, priority, conditions: { merchantKey: normalizeDescription(description).key, direction: amountMinor < 0n ? "out" : "in" }, actions };
}
