import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Money columns are integer minor units (agorot) + ISO currency. Never floats.
const money = (name: string) => bigint(name, { mode: "bigint" });

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const householdRef = () =>
  uuid("household_id")
    .notNull()
    .references(() => household.id);

export const memberRole = pgEnum("member_role", ["admin", "member", "viewer"]);
export const accountType = pgEnum("account_type", ["bank", "credit_card", "savings", "investment", "cash"]);
export const visibility = pgEnum("visibility", ["shared", "private"]);
export const importStatus = pgEnum("import_status", ["uploaded", "parsed", "failed", "committed", "discarded"]);
export const txStatus = pgEnum("tx_status", ["pending", "posted"]);
export const txKind = pgEnum("tx_kind", [
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
]);
export const classificationSource = pgEnum("classification_source", [
  "manual",
  "rule",
  "merchant",
  "dictionary",
  "neighbour",
  "ai",
  "settlement",
  "none",
]);
export const categoryType = pgEnum("category_type", ["expense", "income"]);
export const aliasMatch = pgEnum("alias_match", ["exact", "prefix", "regex"]);
export const goalType = pgEnum("goal_type", ["save_amount", "savings_rate", "reduce_category"]);
export const goalStatus = pgEnum("goal_status", ["active", "archived"]);

export const household = pgTable("household", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  baseCurrency: char("base_currency", { length: 3 }).notNull().default("ILS"),
  ...timestamps,
});

export const appUser = pgTable("app_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecretEnc: text("totp_secret_enc"),
  // two-factor is mandatory: a user without a confirmed TOTP can only finish enrollment
  totpConfirmedAt: timestamp("totp_confirmed_at", { withTimezone: true }),
  locale: text("locale").notNull().default("he"),
  ...timestamps,
});

/** Login sessions. Only a hash of the cookie token is stored. */
export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    // password accepted; the session is usable only once the TOTP code is verified too
    totpVerified: boolean("totp_verified").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const householdMember = pgTable(
  "household_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    userId: uuid("user_id").references(() => appUser.id),
    displayName: text("display_name").notNull(),
    role: memberRole("role").notNull().default("member"),
    ...timestamps,
  },
  (t) => [uniqueIndex("household_member_user_uq").on(t.householdId, t.userId)],
);

/** One-time invite links; only a hash of the token is stored. */
export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    // the member the invitee becomes (created beforehand, e.g. the partner from setup)
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMember.id, { onDelete: "cascade" }),
    email: text("email"),
    role: memberRole("role").notNull().default("member"),
    tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
    invitedBy: uuid("invited_by").references(() => householdMember.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invitation_member_idx").on(t.memberId)],
);

export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: householdRef(),
  type: accountType("type").notNull(),
  institution: text("institution").notNull(),
  name: text("name").notNull(),
  numberLast4: char("number_last4", { length: 4 }),
  currency: char("currency", { length: 3 }).notNull().default("ILS"),
  // null owner = shared account
  ownerMemberId: uuid("owner_member_id").references(() => householdMember.id),
  visibility: visibility("visibility").notNull().default("shared"),
  // credit cards: the bank account their monthly bill is debited from
  settlesToAccountId: uuid("settles_to_account_id").references((): AnyPgColumn => account.id),
  // false for cards whose statements are never imported: their bank bill debit then counts
  // as one unitemized expense instead of being excluded as a settlement
  tracksStatements: boolean("tracks_statements").notNull().default(true),
  // regex matched against bank debit descriptions to attribute an unmatched bill to this card
  billDescriptionPattern: text("bill_description_pattern"),
  ...timestamps,
});

export const importFile = pgTable(
  "import_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    accountId: uuid("account_id").references(() => account.id),
    uploadedBy: uuid("uploaded_by").references(() => householdMember.id),
    fileName: text("file_name").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    blobPath: text("blob_path").notNull(), // AES-256-GCM encrypted at rest
    mimeType: text("mime_type").notNull(),
    institution: text("institution"),
    // what the statement says about its account (institution, card last 4, bank account)
    accountHint: jsonb("account_hint"),
    // the parser's output (ParsedStatement, bigints as strings); commit works from this
    parsed: jsonb("parsed"),
    parser: text("parser"),
    parserVersion: integer("parser_version"),
    status: importStatus("status").notNull().default("uploaded"),
    // { statementTotalMinor, parsedTotalMinor, diffMinor, ok, overriddenBy? }
    reconciliation: jsonb("reconciliation"),
    stats: jsonb("stats"),
    error: text("error"),
    ...timestamps,
  },
  (t) => [uniqueIndex("import_file_sha_uq").on(t.householdId, t.sha256)],
);

export const rawRow = pgTable(
  "raw_row",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    importFileId: uuid("import_file_id")
      .notNull()
      .references(() => importFile.id),
    rowIndex: integer("row_index").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("raw_row_file_idx_uq").on(t.importFileId, t.rowIndex)],
);

export const category = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    parentId: uuid("parent_id").references((): AnyPgColumn => category.id),
    type: categoryType("type").notNull(),
    slug: text("slug").notNull(),
    nameHe: text("name_he").notNull(),
    nameEn: text("name_en").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("category_slug_uq").on(t.householdId, t.slug)],
);

export const merchant = pgTable("merchant", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: householdRef(),
  name: text("name").notNull(),
  defaultCategoryId: uuid("default_category_id").references(() => category.id),
  mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => merchant.id),
  ...timestamps,
});

export const merchantAlias = pgTable(
  "merchant_alias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchant.id),
    pattern: text("pattern").notNull(), // normalized description key
    match: aliasMatch("match").notNull().default("exact"),
    source: classificationSource("source").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("merchant_alias_uq").on(t.householdId, t.pattern, t.match)],
);

export const transaction = pgTable(
  "transaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    rawRowId: uuid("raw_row_id").references(() => rawRow.id),
    fingerprint: char("fingerprint", { length: 64 }).notNull(),
    purchaseDate: date("purchase_date").notNull(),
    postingDate: date("posting_date"),
    amount: money("amount").notNull(), // signed: negative = money out
    currency: char("currency", { length: 3 }).notNull().default("ILS"),
    originalAmount: money("original_amount"),
    originalCurrency: char("original_currency", { length: 3 }),
    descriptionRaw: text("description_raw").notNull(),
    descriptionNorm: text("description_norm").notNull(),
    // issuer's own labels, kept so re-classification sees the same inputs as the import did
    categoryHint: text("category_hint"),
    typeHint: text("type_hint"),
    merchantId: uuid("merchant_id").references(() => merchant.id),
    categoryId: uuid("category_id").references(() => category.id),
    kind: txKind("kind").notNull().default("expense"),
    status: txStatus("status").notNull().default("posted"),
    installmentNo: integer("installment_no"),
    installmentTotal: integer("installment_total"),
    installmentOriginalAmount: money("installment_original_amount"),
    memberId: uuid("member_id").references(() => householdMember.id),
    isShared: boolean("is_shared").notNull().default(false),
    classificationSource: classificationSource("classification_source").notNull().default("none"),
    classificationConfidence: real("classification_confidence"),
    classificationReason: text("classification_reason"),
    needsReview: boolean("needs_review").notNull().default(false),
    reviewReason: text("review_reason"),
    // manual edits are pinned and never overwritten by reprocessing
    isManuallyEdited: boolean("is_manually_edited").notNull().default(false),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => transaction.id),
    settlementGroupId: uuid("settlement_group_id"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("transaction_fingerprint_uq").on(t.accountId, t.fingerprint),
    index("transaction_hh_date_idx").on(t.householdId, t.purchaseDate),
    index("transaction_hh_cat_date_idx").on(t.householdId, t.categoryId, t.purchaseDate),
    index("transaction_hh_merchant_date_idx").on(t.householdId, t.merchantId, t.purchaseDate),
    index("transaction_desc_trgm_idx").using("gin", sql`${t.descriptionNorm} gin_trgm_ops`),
    index("transaction_review_idx").on(t.householdId, t.needsReview),
  ],
);

export const transactionSplit = pgTable("transaction_split", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: householdRef(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transaction.id),
  amount: money("amount").notNull(),
  categoryId: uuid("category_id").references(() => category.id),
  memberId: uuid("member_id").references(() => householdMember.id),
  ...timestamps,
});

export const categorizationRule = pgTable("categorization_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: householdRef(),
  priority: integer("priority").notNull().default(100),
  // { merchantId?, descriptionRegex?, amountMin?, amountMax?, accountId? }
  conditions: jsonb("conditions").notNull(),
  // { categoryId?, kind?, memberId?, isShared? }
  actions: jsonb("actions").notNull(),
  createdFromCorrection: boolean("created_from_correction").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
});

/** A card bill as printed on an imported statement: the amount the issuer debits from the bank. */
export const cardBill = pgTable(
  "card_bill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    cardAccountId: uuid("card_account_id")
      .notNull()
      .references(() => account.id),
    importFileId: uuid("import_file_id")
      .notNull()
      .references(() => importFile.id),
    postingDate: date("posting_date").notNull(),
    total: money("total").notNull(), // positive
    label: text("label").notNull(),
    ...timestamps,
  },
  // the same bill imported as PDF and as XLSX is one bill
  (t) => [uniqueIndex("card_bill_uq").on(t.cardAccountId, t.postingDate, t.total)],
);

/** Links a card bill to the bank debit that paid it; that debit is then excluded from spending. */
export const cardSettlement = pgTable("card_settlement", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: householdRef(),
  cardBillId: uuid("card_bill_id")
    .notNull()
    .unique()
    .references(() => cardBill.id),
  bankTransactionId: uuid("bank_transaction_id")
    .notNull()
    .unique()
    .references(() => transaction.id),
  dayDiff: integer("day_diff").notNull(),
  ...timestamps,
});

export const balanceSnapshot = pgTable("balance_snapshot", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: householdRef(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id),
  asOf: date("as_of").notNull(),
  balance: money("balance").notNull(),
  source: text("source").notNull(), // "import" | "manual"
  ...timestamps,
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    actorMemberId: uuid("actor_member_id").references(() => householdMember.id),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);

/** A monthly spending limit for a category, for the household or one member. */
export const budget = pgTable(
  "budget",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id),
    // null = the whole household
    memberId: uuid("member_id").references(() => householdMember.id),
    monthlyLimit: money("monthly_limit").notNull(),
    // warn once spending reaches this share of the limit
    alertRatio: real("alert_ratio").notNull().default(0.8),
    ...timestamps,
  },
  (t) => [index("budget_household_idx").on(t.householdId)],
);

/** A financial goal; progress is computed from the ledger, never stored. */
export const goal = pgTable(
  "goal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    name: text("name").notNull(),
    type: goalType("type").notNull(),
    // save_amount
    targetAmount: money("target_amount"),
    deadline: date("deadline"),
    // savings_rate (0..1)
    targetRate: real("target_rate"),
    // reduce_category: cut `categoryId` spending by `reducePct` (0..1) against `baselineMonthly`
    categoryId: uuid("category_id").references(() => category.id),
    reducePct: real("reduce_pct"),
    baselineMonthly: money("baseline_monthly"),
    // first month that counts (YYYY-MM)
    startMonth: char("start_month", { length: 7 }).notNull(),
    // null = shared household goal
    memberId: uuid("member_id").references(() => householdMember.id),
    status: goalStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [index("goal_household_idx").on(t.householdId)],
);

export const assistantRole = pgEnum("assistant_role", ["user", "assistant"]);

export const assistantConversation = pgTable(
  "assistant_conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    // who asked; the conversation is private to them
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMember.id),
    title: text("title").notNull(),
    ...timestamps,
  },
  (t) => [index("assistant_conversation_member_idx").on(t.householdId, t.memberId)],
);

/**
 * Every API turn of a conversation, append-only and exactly as sent/received (thinking blocks,
 * tool calls and tool results included), so the conversation can be replayed to the API and
 * every answer audited against the data it was based on.
 */
export const assistantMessage = pgTable(
  "assistant_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => assistantConversation.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: assistantRole("role").notNull(),
    content: jsonb("content").notNull(),
    // shown in the chat (the question and the final answer); tool turns are kept but hidden
    visible: boolean("visible").notNull().default(false),
    displayText: text("display_text"),
    // final answers: which tool calls they drew on, and which numbers couldn't be traced to them
    toolCalls: jsonb("tool_calls"),
    verification: jsonb("verification"),
    usage: jsonb("usage"),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("assistant_message_seq_uq").on(t.conversationId, t.seq)],
);
