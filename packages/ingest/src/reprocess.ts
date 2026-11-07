// Re-parsing stored statements when a parser improves. The original file is kept (encrypted), so
// it is parsed again and the differences applied: corrected facts on existing rows, rows the old
// parser missed, and (on request) rows it invented. Manual edits are never overwritten, and a row
// the user edited or that pays a card bill is never deleted.
import { and, eq, inArray, sql } from "drizzle-orm";
import { fingerprintBatch, normalizeDescription } from "@ft/core";
import { parseFile, reconcile, type InputFile, type ParsedStatement, type ReconciliationResult } from "@ft/parsers";
import { account, auditLog, cardBill, cardSettlement, importFile, rawRow, transaction, transactionSplit, type Db } from "@ft/db";
import { ensureCategories, loadClassifierContext } from "./context.js";
import { reclassify } from "./corrections.js";
import { ImportError, insertParsedRow, type IngestDeps } from "./import.js";
import { statementToJson } from "./serialize.js";

export type Parse = (file: InputFile) => Promise<{ statement: ParsedStatement }>;

export interface ReprocessPlan {
  importId: string;
  committed: boolean;
  adapter: string;
  fromVersion: number | null;
  toVersion: number;
  reconciliation: ReconciliationResult;
  added: { purchaseDate: string; description: string; amountMinor: bigint }[];
  updated: { transactionId: string; description: string; changes: string[] }[];
  unchanged: number;
  /** rows the new parse no longer produces, or that turn out to duplicate another import's row */
  removed: { transactionId: string; purchaseDate: string; description: string; amountMinor: bigint; keep: null | "edited" | "pays_card_bill" | "split"; duplicate?: boolean }[];
  /** new rows already present from another import of the same account */
  elsewhere: number;
}

const FIELDS = ["postingDate", "originalAmount", "originalCurrency", "categoryHint", "typeHint", "installmentNo", "installmentTotal", "installmentOriginalAmount", "notes"] as const;

function factsOf(t: ParsedStatement["transactions"][number]) {
  return {
    postingDate: t.postingDate ?? null,
    originalAmount: t.originalAmount?.minor ?? null,
    originalCurrency: t.originalAmount?.currency ?? null,
    categoryHint: t.categoryHint ?? null,
    typeHint: t.typeHint ?? null,
    installmentNo: t.installment?.no ?? null,
    installmentTotal: t.installment?.total ?? null,
    installmentOriginalAmount: t.installment?.originalAmount?.minor ?? null,
    notes: t.notes ?? null,
  };
}

async function load(deps: IngestDeps, db: Db, householdId: string, importId: string, parse: Parse) {
  const [imp] = await db.select().from(importFile).where(and(eq(importFile.id, importId), eq(importFile.householdId, householdId)));
  if (!imp) throw new ImportError("not_found", "Import not found");
  if (imp.status !== "committed" && imp.status !== "parsed") throw new ImportError("bad_state", `Import is ${imp.status}, not ready to commit`);
  const bytes = await deps.blobs.get(imp.blobPath);
  const { statement } = await parse({ fileName: imp.fileName, bytes });
  return { imp, statement };
}

async function plan(deps: IngestDeps, db: Db, householdId: string, importId: string, parse: Parse) {
  const { imp, statement } = await load(deps, db, householdId, importId, parse);
  const base = {
    importId,
    committed: imp.status === "committed",
    adapter: statement.adapter,
    fromVersion: imp.parserVersion,
    toVersion: statement.adapterVersion,
    reconciliation: reconcile(statement),
  };
  if (imp.status !== "committed" || !imp.accountId) {
    return { imp, statement, plan: { ...base, added: [], updated: [], unchanged: 0, removed: [], elsewhere: 0 } satisfies ReprocessPlan, fps: [] as string[], matches: [] as (Tx | undefined)[] };
  }
  const fps = fingerprintBatch(
    statement.transactions.map((t) => ({ accountId: imp.accountId!, purchaseDate: t.purchaseDate, amountMinor: t.amount.minor, currency: t.amount.currency, descriptionRaw: t.description, installmentNo: t.installment?.no })),
  );
  // the transactions this import created (through any parser version's raw rows)
  const existing = (
    await db
      .select({ t: transaction })
      .from(transaction)
      .innerJoin(rawRow, eq(rawRow.id, transaction.rawRowId))
      .where(eq(rawRow.importFileId, imp.id))
  ).map((r) => r.t);
  const matches = matchRows(statement, fps, existing);
  // which transaction of the account already holds each new fingerprint
  const holder = fps.length
    ? new Map(
        (await db.select({ fp: transaction.fingerprint, id: transaction.id }).from(transaction).where(and(eq(transaction.accountId, imp.accountId), inArray(transaction.fingerprint, fps)))).map((r) => [r.fp, r.id]),
      )
    : new Map<string, string>();
  const others = new Set(holder.keys());
  // a matched row whose new fingerprint belongs to another transaction duplicates that one
  const duplicates = new Set<string>();
  matches.forEach((m, i) => {
    const owner = holder.get(fps[i]!);
    if (m && owner && owner !== m.id) {
      duplicates.add(m.id);
      matches[i] = undefined;
    }
  });

  const result: ReprocessPlan = { ...base, added: [], updated: [], unchanged: 0, removed: [], elsewhere: 0 };
  statement.transactions.forEach((t, i) => {
    const current = matches[i];
    if (current) {
      const facts = factsOf(t);
      const changes = FIELDS.filter((f) => String(facts[f] ?? "") !== String(current[f] ?? ""));
      if (changes.length) result.updated.push({ transactionId: current.id, description: current.descriptionRaw, changes });
      else result.unchanged++;
    } else if (others.has(fps[i]!) && !duplicates.has(holder.get(fps[i]!)!)) result.elsewhere++;
    else result.added.push({ purchaseDate: t.purchaseDate, description: t.description, amountMinor: t.amount.minor });
  });

  const matched = new Set(matches.filter(Boolean).map((t) => t!.id));
  const gone = existing.filter((t) => !matched.has(t.id));
  const ids = gone.map((t) => t.id);
  const settled = ids.length ? new Set((await db.select({ id: cardSettlement.bankTransactionId }).from(cardSettlement).where(inArray(cardSettlement.bankTransactionId, ids))).map((r) => r.id)) : new Set();
  const split = ids.length ? new Set((await db.select({ id: transactionSplit.transactionId }).from(transactionSplit).where(inArray(transactionSplit.transactionId, ids))).map((r) => r.id)) : new Set();
  for (const t of gone) {
    result.removed.push({
      transactionId: t.id,
      purchaseDate: t.purchaseDate,
      description: t.descriptionRaw,
      amountMinor: t.amount,
      keep: t.isManuallyEdited ? "edited" : settled.has(t.id) ? "pays_card_bill" : split.has(t.id) ? "split" : null,
      ...(duplicates.has(t.id) ? { duplicate: true } : {}),
    });
  }
  return { imp, statement, plan: result, fps, matches };
}

type Tx = typeof transaction.$inferSelect;

/**
 * Pairs each newly parsed row with the transaction it corresponds to: by fingerprint first, then
 * (one-to-one) by date, amount and description, because a parser fix can change what the
 * fingerprint covers (e.g. a newly read installment number) without it being a different purchase.
 */
function matchRows(statement: ParsedStatement, fps: string[], existing: Tx[]): (Tx | undefined)[] {
  const byFp = new Map(existing.map((t) => [t.fingerprint, t]));
  const used = new Set<string>();
  const out: (Tx | undefined)[] = fps.map((fp) => {
    const t = byFp.get(fp);
    if (t) used.add(t.id);
    return t;
  });
  const identity = (date: string, amount: bigint, description: string) => `${date}|${amount}|${normalizeDescription(description).key}`;
  statement.transactions.forEach((t, i) => {
    if (out[i]) return;
    const key = identity(t.purchaseDate, t.amount.minor, t.description);
    const candidate = existing.find((e) => !used.has(e.id) && identity(e.purchaseDate, e.amount, e.descriptionRaw) === key);
    if (candidate) {
      used.add(candidate.id);
      out[i] = candidate;
    }
  });
  return out;
}

/** What re-parsing an import with the installed parser would change (no changes are made). */
export async function planReprocess(deps: IngestDeps, householdId: string, importId: string, parse: Parse = parseFile): Promise<ReprocessPlan> {
  return (await plan(deps, deps.db, householdId, importId, parse)).plan;
}

export interface ApplyReprocessInput {
  householdId: string;
  importId: string;
  actorMemberId?: string;
  /** delete rows the new parse no longer produces (never edited or bill-paying ones) */
  removeMissing?: boolean;
  overrideReconciliation?: { reason: string };
}

export async function applyReprocess(deps: IngestDeps, input: ApplyReprocessInput, parse: Parse = parseFile): Promise<ReprocessPlan> {
  return deps.db.transaction(async (db) => {
    const { householdId } = input;
    const { imp, statement, plan: p, fps, matches } = await plan(deps, db, householdId, input.importId, parse);
    if (!p.reconciliation.ok && !input.overrideReconciliation) {
      throw new ImportError("unreconciled", "The statement's totals don't match its transactions", p.reconciliation.problems);
    }
    const version = statement.adapterVersion;
    await db
      .insert(rawRow)
      .values(statement.transactions.map((t) => ({ householdId, importFileId: imp.id, rowIndex: t.rowIndex, parserVersion: version, payload: t.raw })))
      .onConflictDoNothing();

    if (p.committed && imp.accountId) {
      const rawIds = new Map(
        (await db.select({ id: rawRow.id, rowIndex: rawRow.rowIndex }).from(rawRow).where(and(eq(rawRow.importFileId, imp.id), eq(rawRow.parserVersion, version)))).map((r) => [r.rowIndex, r.id]),
      );
      const [acct] = await db.select().from(account).where(eq(account.id, imp.accountId));
      const maps = await ensureCategories(db, householdId);
      const ctx = await loadClassifierContext(db, householdId, maps);
      for (const [i, t] of statement.transactions.entries()) {
        const current = matches[i];
        const rawRowId = rawIds.get(t.rowIndex) ?? null;
        if (current) {
          // the parser's facts (and the fingerprint they feed) are updated on every row;
          // classification stays (re-run below for rows that weren't edited by hand)
          await db.update(transaction).set({ ...factsOf(t), fingerprint: fps[i]!, rawRowId, updatedAt: new Date() }).where(eq(transaction.id, current.id));
        } else {
          await insertParsedRow(db, { householdId, acct: acct!, rawRowId, fingerprint: fps[i]!, t, accountType: statement.account.type, ctx, maps });
        }
      }
      if (input.removeMissing) {
        const removable = p.removed.filter((r) => r.keep === null).map((r) => r.transactionId);
        if (removable.length) {
          // anything that pointed at them as "superseded by" stops pointing anywhere
          await db.update(transaction).set({ supersededById: null }).where(inArray(transaction.supersededById, removable));
          await db.delete(transaction).where(inArray(transaction.id, removable));
        }
      }
      if (acct!.type === "credit_card") {
        const totals = statement.totals.filter((x) => x.postingDate);
        for (const total of totals) {
          await db
            .insert(cardBill)
            .values({ householdId, cardAccountId: acct!.id, importFileId: imp.id, postingDate: total.postingDate!, total: total.amount.minor, label: total.label })
            .onConflictDoNothing();
        }
        // bills of this import the new parse no longer prints, unless already matched to a payment
        const keep = new Set(totals.map((x) => `${x.postingDate}|${x.amount.minor}`));
        const stale = (await db.select().from(cardBill).where(eq(cardBill.importFileId, imp.id))).filter((b) => !keep.has(`${b.postingDate}|${b.total}`));
        for (const b of stale) {
          const [linked] = await db.select({ id: cardSettlement.id }).from(cardSettlement).where(eq(cardSettlement.cardBillId, b.id));
          if (!linked) await db.delete(cardBill).where(eq(cardBill.id, b.id));
        }
      }
    }

    await db
      .update(importFile)
      .set({
        parser: statement.adapter,
        parserVersion: version,
        parsed: statementToJson(statement),
        accountHint: statement.account,
        reconciliation: JSON.parse(JSON.stringify(p.reconciliation, (_, x) => (typeof x === "bigint" ? x.toString() : x))),
        updatedAt: new Date(),
      })
      .where(eq(importFile.id, imp.id));
    await db.insert(auditLog).values({
      householdId,
      actorMemberId: input.actorMemberId ?? null,
      entity: "import_file",
      entityId: imp.id,
      action: "reprocess",
      before: { parserVersion: p.fromVersion },
      after: {
        parserVersion: version,
        added: p.added.length,
        updated: p.updated.length,
        removed: input.removeMissing ? p.removed.filter((r) => r.keep === null).length : 0,
        kept: p.removed.filter((r) => r.keep !== null || !input.removeMissing).length,
      },
      reason: input.overrideReconciliation?.reason ?? null,
    });
    // corrected issuer labels can change categories; settlements follow from the new bills
    if (p.committed) await reclassify(db, householdId);
    return p;
  });
}

/** Imports parsed by an older version of their parser than the one installed. */
export async function outdatedImports(db: Db, householdId: string, versions: (adapter: string) => number | null) {
  const rows = await db
    .select({ id: importFile.id, fileName: importFile.fileName, parser: importFile.parser, version: importFile.parserVersion, status: importFile.status })
    .from(importFile)
    .where(and(eq(importFile.householdId, householdId), inArray(importFile.status, ["parsed", "committed"]), sql`${importFile.parser} is not null`));
  return rows.filter((r) => {
    const v = versions(r.parser!);
    return v !== null && (r.version ?? 0) < v;
  });
}

