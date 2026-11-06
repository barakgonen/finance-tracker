// Transaction kind is orthogonal to category and decides what counts in reporting.

export const TRANSACTION_KINDS = [
  "expense",
  "income",
  "refund",
  "reversal",
  "internal_transfer",
  "card_settlement",
  "savings_investment",
  "fee",
  "cash_withdrawal",
  "p2p_transfer",
  "loan_payment",
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** Kinds whose amounts count toward spending (refunds/reversals offset spending). */
export const SPENDING_KINDS: ReadonlySet<TransactionKind> = new Set([
  "expense",
  "fee",
  "refund",
  "reversal",
  "cash_withdrawal",
  "loan_payment",
]);

export const INCOME_KINDS: ReadonlySet<TransactionKind> = new Set(["income"]);

/** Kinds that move money between the household's own pockets and must never count as spending. */
export const NEUTRAL_KINDS: ReadonlySet<TransactionKind> = new Set([
  "internal_transfer",
  "card_settlement",
  "savings_investment",
]);
