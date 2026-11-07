// Card bills and the bank debits that pay them, both ways: from a bank debit to the statement
// bills it paid (and their itemized rows), and from an imported statement to its bank debit.
import { and, eq, inArray, sql } from "drizzle-orm";
import { account, cardBill, cardSettlement, transaction, type Db } from "@ft/db";
import type { Filters } from "./index.js";

export interface LinkedBill {
  billId: string;
  debitId: string;
  /** null when the card is another member's private account */
  cardName: string | null;
  cardLast4: string | null;
  postingDate: string;
  totalMinor: bigint;
  /** the statement rows this bill itemizes */
  rowCount: number;
}

const hiddenFrom = (f: Filters) =>
  f.viewerMemberId ? sql<boolean>`(${account.visibility} = 'private' and ${account.ownerMemberId} is distinct from ${f.viewerMemberId})` : sql<boolean>`false`;

const rowCount = sql<number>`(select count(*)::int from ${transaction} where ${transaction.cardBillId} = ${cardBill.id} and ${transaction.supersededById} is null)`;

/** The bills each of these bank debits paid. */
export async function billsForDebits(db: Db, f: Filters, debitIds: string[]): Promise<Map<string, LinkedBill[]>> {
  const out = new Map<string, LinkedBill[]>();
  if (!debitIds.length) return out;
  const rows = await db
    .select({
      billId: cardBill.id,
      debitId: cardSettlement.bankTransactionId,
      cardName: account.name,
      cardLast4: account.numberLast4,
      hidden: hiddenFrom(f),
      postingDate: cardBill.postingDate,
      totalMinor: cardBill.total,
      rowCount,
    })
    .from(cardSettlement)
    .innerJoin(cardBill, eq(cardBill.id, cardSettlement.cardBillId))
    .innerJoin(account, eq(account.id, cardBill.cardAccountId))
    .where(and(eq(cardSettlement.householdId, f.householdId), inArray(cardSettlement.bankTransactionId, debitIds)))
    .orderBy(cardBill.postingDate, account.name);
  for (const { hidden, ...r } of rows) {
    const bill: LinkedBill = { ...r, cardName: hidden ? null : r.cardName, cardLast4: hidden ? null : r.cardLast4, rowCount: hidden ? 0 : r.rowCount };
    out.set(r.debitId, [...(out.get(r.debitId) ?? []), bill]);
  }
  return out;
}

export interface StatementBill {
  billId: string;
  label: string;
  postingDate: string;
  totalMinor: bigint;
  /** the bank debit that paid it, once imported and matched */
  debit: { id: string; date: string; amountMinor: bigint; accountName: string; billsPaid: number } | null;
}

/** The bills an imported card statement printed, with their bank side. */
export async function billsOfImport(db: Db, f: Filters, importFileId: string): Promise<StatementBill[]> {
  const rows = await db
    .select({
      billId: cardBill.id,
      label: cardBill.label,
      postingDate: cardBill.postingDate,
      totalMinor: cardBill.total,
      debitId: transaction.id,
      debitDate: transaction.purchaseDate,
      debitAmount: transaction.amount,
      accountName: sql<string | null>`(select ${account.name} from ${account} where ${account.id} = ${transaction.accountId})`,
      billsPaid: sql<number>`(select count(*)::int from card_settlement s where s.bank_transaction_id = ${transaction.id})`,
    })
    .from(cardBill)
    .leftJoin(cardSettlement, eq(cardSettlement.cardBillId, cardBill.id))
    .leftJoin(transaction, eq(transaction.id, cardSettlement.bankTransactionId))
    .where(and(eq(cardBill.householdId, f.householdId), eq(cardBill.importFileId, importFileId)))
    .orderBy(cardBill.postingDate);
  return rows.map((r) => ({
    billId: r.billId,
    label: r.label,
    postingDate: r.postingDate,
    totalMinor: r.totalMinor,
    debit: r.debitId ? { id: r.debitId, date: r.debitDate!, amountMinor: r.debitAmount!, accountName: r.accountName ?? "", billsPaid: r.billsPaid } : null,
  }));
}

/** One bill, for the header of its transactions list; null if unknown or not the viewer's to see. */
export async function billSummary(db: Db, f: Filters, billId: string) {
  const [r] = await db
    .select({ billId: cardBill.id, cardName: account.name, cardLast4: account.numberLast4, hidden: hiddenFrom(f), postingDate: cardBill.postingDate, totalMinor: cardBill.total, debitId: cardSettlement.bankTransactionId })
    .from(cardBill)
    .innerJoin(account, eq(account.id, cardBill.cardAccountId))
    .leftJoin(cardSettlement, eq(cardSettlement.cardBillId, cardBill.id))
    .where(and(eq(cardBill.householdId, f.householdId), eq(cardBill.id, billId)));
  if (!r || r.hidden) return null;
  const { hidden: _, ...bill } = r;
  return bill;
}
