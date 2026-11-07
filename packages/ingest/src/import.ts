// The import workflow: stage (store + parse) -> preview -> commit or discard.
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  classify,
  fingerprintBatch,
  matchPendingToPosted,
  normalizeDescription,
  type Classification,
} from "@ft/core";
import { parseFile, reconcile, type InputFile, type ParsedStatement, type ReconciliationResult } from "@ft/parsers";
import { account, auditLog, balanceSnapshot, cardBill, importFile, rawRow, transaction, type Db } from "@ft/db";
import type { BlobStore } from "./blobs.js";
import { sha256 } from "./blobs.js";
import { ensureCategories, loadClassifierContext, type CategoryMaps } from "./context.js";
import type { ClassifierContext } from "@ft/core";
import { resolveMerchant } from "./merchants.js";
import { reconcileSettlements, type SettlementSummary } from "./settlement.js";
import { statementFromJson, statementToJson } from "./serialize.js";

export interface IngestDeps {
  db: Db & { transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T> };
  blobs: BlobStore;
}

export type ImportErrorCode = "duplicate_file" | "not_found" | "bad_state" | "no_account" | "account_mismatch" | "unreconciled";

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type RowStatus = "new" | "duplicate" | "supersedes_pending";

export interface PreviewRow {
  rowIndex: number;
  purchaseDate: string;
  description: string;
  amountMinor: bigint;
  currency: string;
  status: RowStatus;
  classification: Classification;
}

export interface ImportPreview {
  importId: string;
  fileName: string;
  status: string;
  adapter: string | null;
  accountId: string | null;
  error: string | null;
  reconciliation: ReconciliationResult | null;
  warnings: string[];
  counts: { total: number; new: number; duplicate: number; supersedesPending: number; needsReview: number };
  rows: PreviewRow[];
}

export interface StageInput {
  householdId: string;
  file: InputFile;
  uploadedBy?: string;
  /** Account the user picked; otherwise resolved from what the statement says. */
  accountId?: string;
}

export async function stageImport(deps: IngestDeps, input: StageInput): Promise<ImportPreview> {
  const { householdId, file } = input;
  let statement: ParsedStatement | undefined;
  let error: string | undefined;
  try {
    ({ statement } = await parseFile(file));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return stageStatement(deps, { ...input, statement, error });
}

/** Stages an already-parsed statement (other sources, e.g. a future bank scraper, and tests). */
export async function stageStatement(
  deps: IngestDeps,
  input: StageInput & { statement?: ParsedStatement; error?: string },
): Promise<ImportPreview> {
  const { db, blobs } = deps;
  const { householdId, file, statement, error } = input;
  const hash = sha256(file.bytes);

  const [existing] = await db
    .select()
    .from(importFile)
    .where(and(eq(importFile.householdId, householdId), eq(importFile.sha256, hash)));
  if (existing && existing.status !== "discarded") {
    throw new ImportError("duplicate_file", `This file was already imported (${existing.fileName})`, { importId: existing.id });
  }

  const blobPath = await blobs.put(householdId, file.bytes);
  const accountId = input.accountId ?? (statement ? await resolveAccount(db, householdId, statement) : undefined);
  const values = {
    householdId,
    accountId: accountId ?? null,
    uploadedBy: input.uploadedBy ?? null,
    fileName: file.fileName,
    sha256: hash,
    blobPath,
    mimeType: mimeOf(file.fileName),
    institution: statement?.account.institution ?? null,
    accountHint: statement?.account ?? null,
    parser: statement?.adapter ?? null,
    parserVersion: statement?.adapterVersion ?? null,
    parsed: statement ? statementToJson(statement) : null,
    reconciliation: statement ? jsonSafe(reconcile(statement)) : null,
    status: statement ? ("parsed" as const) : ("failed" as const),
    error: error ?? null,
    updatedAt: new Date(),
  };
  const id = existing
    ? (await db.update(importFile).set(values).where(eq(importFile.id, existing.id)).returning({ id: importFile.id }))[0]!.id
    : (await db.insert(importFile).values(values).returning({ id: importFile.id }))[0]!.id;

  // the parser's view of each source row is kept immutable, linked to the transaction it becomes
  if (statement && statement.transactions.length > 0) {
    await db
      .insert(rawRow)
      .values(statement.transactions.map((t) => ({ householdId, importFileId: id, rowIndex: t.rowIndex, parserVersion: statement.adapterVersion, payload: t.raw })))
      .onConflictDoNothing();
  }
  return getPreview(deps, householdId, id);
}

export async function getPreview(deps: IngestDeps, householdId: string, importId: string): Promise<ImportPreview> {
  const { db } = deps;
  const imp = await loadImport(db, householdId, importId);
  const base = {
    importId: imp.id,
    fileName: imp.fileName,
    status: imp.status,
    adapter: imp.parser,
    accountId: imp.accountId,
    error: imp.error,
  };
  if (!imp.parsed) {
    return { ...base, reconciliation: null, warnings: [], counts: { total: 0, new: 0, duplicate: 0, supersedesPending: 0, needsReview: 0 }, rows: [] };
  }
  const statement = statementFromJson(imp.parsed);
  const acct = imp.accountId ? await loadAccount(db, householdId, imp.accountId) : null;
  const maps = await ensureCategories(db, householdId);
  const ctx = await loadClassifierContext(db, householdId, maps);
  const planned = acct ? await planRows(db, acct.id, statement) : statement.transactions.map(() => ({ fingerprint: "", status: "new" as RowStatus, supersedes: null }));

  const rows: PreviewRow[] = statement.transactions.map((t, i) => ({
    rowIndex: t.rowIndex,
    purchaseDate: t.purchaseDate,
    description: t.description,
    amountMinor: t.amount.minor,
    currency: t.amount.currency,
    status: planned[i]!.status,
    classification: classify(classifyInput(t, statement.account.type, acct?.id), ctx),
  }));
  return {
    ...base,
    reconciliation: reconcile(statement),
    warnings: statement.warnings,
    counts: {
      total: rows.length,
      new: rows.filter((r) => r.status === "new").length,
      duplicate: rows.filter((r) => r.status === "duplicate").length,
      supersedesPending: rows.filter((r) => r.status === "supersedes_pending").length,
      needsReview: rows.filter((r) => r.status !== "duplicate" && r.classification.needsReview).length,
    },
    rows,
  };
}

export interface CommitInput {
  householdId: string;
  importId: string;
  actorMemberId?: string;
  /** Required when the preview was staged without a resolvable account. */
  accountId?: string;
  /** Commit even though totals don't reconcile; the reason is written to the audit log. */
  overrideReconciliation?: { reason: string };
}

export interface CommitResult {
  inserted: number;
  duplicates: number;
  supersededPending: number;
  settlements: SettlementSummary;
}

export async function commitImport(deps: IngestDeps, input: CommitInput): Promise<CommitResult> {
  return deps.db.transaction(async (db) => {
    const { householdId } = input;
    const imp = await loadImport(db, householdId, input.importId);
    if (imp.status !== "parsed") throw new ImportError("bad_state", `Import is ${imp.status}, not ready to commit`);
    const accountId = input.accountId ?? imp.accountId;
    if (!accountId) throw new ImportError("no_account", "Choose which account this statement belongs to");
    const acct = await loadAccount(db, householdId, accountId);
    const statement = statementFromJson(imp.parsed);
    if ((acct.type === "bank") !== (statement.account.type === "bank")) {
      throw new ImportError("account_mismatch", `A ${statement.account.type} statement can't go into a ${acct.type} account`);
    }
    const rec = reconcile(statement);
    if (!rec.ok && !input.overrideReconciliation) {
      throw new ImportError("unreconciled", "The statement's totals don't match its transactions", rec.problems);
    }

    const maps = await ensureCategories(db, householdId);
    const ctx = await loadClassifierContext(db, householdId, maps);
    const planned = await planRows(db, acct.id, statement);
    const rawIds = new Map(
      (
        await db
          .select({ id: rawRow.id, rowIndex: rawRow.rowIndex })
          .from(rawRow)
          .where(and(eq(rawRow.importFileId, imp.id), eq(rawRow.parserVersion, imp.parserVersion ?? 1)))
      ).map((r) => [r.rowIndex, r.id]),
    );

    let inserted = 0;
    let duplicates = 0;
    let supersededPending = 0;
    for (const [i, t] of statement.transactions.entries()) {
      const plan = planned[i]!;
      if (plan.status === "duplicate") {
        duplicates++;
        continue;
      }
      const row = await insertParsedRow(db, { householdId, acct, rawRowId: rawIds.get(t.rowIndex) ?? null, fingerprint: plan.fingerprint, t, accountType: statement.account.type, ctx, maps });
      if (!row) {
        duplicates++;
        continue;
      }
      inserted++;
      if (plan.supersedes) {
        await db.update(transaction).set({ supersededById: row, updatedAt: new Date() }).where(eq(transaction.id, plan.supersedes));
        supersededPending++;
      }
    }

    if (acct.type === "credit_card") {
      for (const total of statement.totals) {
        if (!total.postingDate) continue;
        await db
          .insert(cardBill)
          .values({ householdId, cardAccountId: acct.id, importFileId: imp.id, postingDate: total.postingDate, total: total.amount.minor, label: total.label })
          .onConflictDoNothing();
      }
    } else {
      const closing = statement.closingBalance ?? latestBalance(statement);
      if (closing) {
        await db.insert(balanceSnapshot).values({ householdId, accountId: acct.id, asOf: closing.asOf, balance: closing.balance.minor, source: "import" });
      }
    }

    const settlements = await reconcileSettlements(db, householdId, maps.idBySlug.get("card_unitemized")!);
    const stats = { inserted, duplicates, supersededPending, settlements };
    await db
      .update(importFile)
      .set({ status: "committed", accountId: acct.id, stats, updatedAt: new Date() })
      .where(eq(importFile.id, imp.id));
    await db.insert(auditLog).values({
      householdId,
      actorMemberId: input.actorMemberId ?? null,
      entity: "import_file",
      entityId: imp.id,
      action: input.overrideReconciliation ? "commit_with_override" : "commit",
      before: null,
      after: { ...stats, reconciliation: jsonSafe(rec) },
      reason: input.overrideReconciliation?.reason ?? null,
    });
    return stats;
  });
}

export async function discardImport(deps: IngestDeps, householdId: string, importId: string, actorMemberId?: string): Promise<void> {
  const imp = await loadImport(deps.db, householdId, importId);
  if (imp.status === "committed") throw new ImportError("bad_state", "A committed import can't be discarded");
  await deps.db.update(importFile).set({ status: "discarded", updatedAt: new Date() }).where(eq(importFile.id, importId));
  await deps.db.insert(auditLog).values({ householdId, actorMemberId: actorMemberId ?? null, entity: "import_file", entityId: importId, action: "discard" });
}

// --- helpers ---

/** Classifies one parsed row and inserts it; null when its fingerprint already exists in the account. */
export async function insertParsedRow(
  db: Db,
  r: {
    householdId: string;
    acct: typeof account.$inferSelect;
    rawRowId: string | null;
    fingerprint: string;
    t: ParsedStatement["transactions"][number];
    accountType: "bank" | "credit_card";
    ctx: ClassifierContext;
    maps: CategoryMaps;
  },
): Promise<string | null> {
  const { householdId, acct, t } = r;
  const c = classify(classifyInput(t, r.accountType, acct.id), r.ctx);
  const tracksMerchant = acct.type === "credit_card" || ["expense", "refund", "fee"].includes(c.kind);
  const [row] = await db
    .insert(transaction)
    .values({
      householdId,
      accountId: acct.id,
      rawRowId: r.rawRowId,
      fingerprint: r.fingerprint,
      purchaseDate: t.purchaseDate,
      postingDate: t.postingDate ?? null,
      amount: t.amount.minor,
      currency: t.amount.currency,
      originalAmount: t.originalAmount?.minor ?? null,
      originalCurrency: t.originalAmount?.currency ?? null,
      descriptionRaw: t.description,
      descriptionNorm: normalizeDescription(t.description).key,
      categoryHint: t.categoryHint ?? null,
      typeHint: t.typeHint ?? null,
      merchantId: tracksMerchant ? await resolveMerchant(db, householdId, t.description) : null,
      categoryId: categoryIdOf(c, r.maps),
      kind: c.kind,
      status: t.status,
      installmentNo: t.installment?.no ?? null,
      installmentTotal: t.installment?.total ?? null,
      installmentOriginalAmount: t.installment?.originalAmount?.minor ?? null,
      memberId: acct.ownerMemberId,
      isShared: acct.ownerMemberId === null,
      classificationSource: c.source,
      classificationConfidence: c.confidence,
      classificationReason: c.reason,
      needsReview: c.needsReview,
      reviewReason: c.needsReview ? "low confidence" : null,
      notes: t.notes ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: transaction.id });
  return row?.id ?? null;
}

interface RowPlan {
  fingerprint: string;
  status: RowStatus;
  /** pending transaction this posted row replaces */
  supersedes: string | null;
}

async function planRows(db: Db, accountId: string, statement: ParsedStatement): Promise<RowPlan[]> {
  const fingerprints = fingerprintBatch(
    statement.transactions.map((t) => ({
      accountId,
      purchaseDate: t.purchaseDate,
      amountMinor: t.amount.minor,
      currency: t.amount.currency,
      descriptionRaw: t.description,
      installmentNo: t.installment?.no,
    })),
  );
  const known = fingerprints.length
    ? new Set(
        (
          await db
            .select({ fp: transaction.fingerprint })
            .from(transaction)
            .where(and(eq(transaction.accountId, accountId), inArray(transaction.fingerprint, fingerprints)))
        ).map((r) => r.fp),
      )
    : new Set<string>();
  const pending = await db
    .select({ id: transaction.id, purchaseDate: transaction.purchaseDate, amountMinor: transaction.amount, descriptionRaw: transaction.descriptionRaw })
    .from(transaction)
    .where(and(eq(transaction.accountId, accountId), eq(transaction.status, "pending"), isNull(transaction.supersededById)));

  const claimed = new Set<string>();
  return statement.transactions.map((t, i) => {
    const fingerprint = fingerprints[i]!;
    if (known.has(fingerprint)) return { fingerprint, status: "duplicate" as const, supersedes: null };
    if (t.status === "posted") {
      const match = matchPendingToPosted(
        { purchaseDate: t.purchaseDate, amountMinor: t.amount.minor, descriptionRaw: t.description },
        pending.filter((p) => !claimed.has(p.id)),
      );
      if (match) {
        claimed.add(match);
        return { fingerprint, status: "supersedes_pending" as const, supersedes: match };
      }
    }
    return { fingerprint, status: "new" as const, supersedes: null };
  });
}

/** Picks the household account a statement belongs to, when that is unambiguous. */
async function resolveAccount(db: Db, householdId: string, statement: ParsedStatement): Promise<string | undefined> {
  const hint = statement.account;
  const candidates = await db
    .select()
    .from(account)
    .where(and(eq(account.householdId, householdId), eq(account.institution, hint.institution), eq(account.type, hint.type)));
  const byCard = hint.cardLast4 ? candidates.filter((a) => a.numberLast4 === hint.cardLast4) : [];
  if (byCard.length === 1) return byCard[0]!.id;
  // statements naming no single card (e.g. Max "all cards") go to the issuer's only account
  const pool = hint.cardLast4 ? candidates.filter((a) => a.numberLast4 === null && a.tracksStatements) : candidates.filter((a) => a.tracksStatements);
  return pool.length === 1 ? pool[0]!.id : undefined;
}

function classifyInput(t: ParsedStatement["transactions"][number], accountType: "bank" | "credit_card", accountId?: string) {
  return { description: t.description, amountMinor: t.amount.minor, accountType, accountId, categoryHint: t.categoryHint, typeHint: t.typeHint };
}

function categoryIdOf(c: Classification, maps: CategoryMaps): string | null {
  return c.category ? (maps.idBySlug.get(c.category) ?? null) : null;
}

function latestBalance(statement: ParsedStatement) {
  const withBalance = statement.transactions.filter((t) => t.balance);
  if (withBalance.length === 0) return undefined;
  const latest = withBalance.reduce((a, b) => (b.purchaseDate > a.purchaseDate ? b : a));
  return { asOf: latest.purchaseDate, balance: latest.balance! };
}

async function loadImport(db: Db, householdId: string, importId: string) {
  const [imp] = await db.select().from(importFile).where(and(eq(importFile.id, importId), eq(importFile.householdId, householdId)));
  if (!imp) throw new ImportError("not_found", "Import not found");
  return imp;
}

async function loadAccount(db: Db, householdId: string, accountId: string) {
  const [acct] = await db.select().from(account).where(and(eq(account.id, accountId), eq(account.householdId, householdId)));
  if (!acct) throw new ImportError("not_found", "Account not found");
  return acct;
}

function mimeOf(name: string): string {
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.xlsx$/i.test(name)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/\.xls$/i.test(name)) return "application/vnd.ms-excel";
  if (/\.csv$/i.test(name)) return "text/csv";
  return "application/octet-stream";
}

function jsonSafe<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}

