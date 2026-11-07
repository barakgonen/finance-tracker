// Keeps card-bill debits in the bank account consistent with imported card statements:
// - a debit that pays an imported bill is a `card_settlement` (excluded from spending, since
//   the card's own transactions are counted);
// - a debit that pays several imported bills at once (two cards, or domestic + abroad sections)
//   is linked to all of them;
// - a debit that nearly equals an open bill is held out of spending and sent to review, since
//   counting it next to that bill's itemized transactions would count the money twice;
// - any other debit with no imported bill counts as one unitemized expense of the card's owner
//   until that statement arrives, so household spending is never understated.
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { issuerForDescription, matchCombinedSettlements, matchSettlements, nearMissBill, type CardBill } from "@ft/core";
import { account, cardBill, cardSettlement, transaction, type Db } from "@ft/db";

export interface SettlementSummary {
  matched: number;
  unitemized: number;
  needsReview: number;
}

export async function reconcileSettlements(db: Db, householdId: string, unitemizedCategoryId: string): Promise<SettlementSummary> {
  const cards = await db
    .select()
    .from(account)
    .where(and(eq(account.householdId, householdId), eq(account.type, "credit_card")));
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const openBills = await db
    .select({ bill: cardBill })
    .from(cardBill)
    .leftJoin(cardSettlement, eq(cardSettlement.cardBillId, cardBill.id))
    .where(and(eq(cardBill.householdId, householdId), isNull(cardSettlement.id)));

  const settled = db.select({ id: cardSettlement.bankTransactionId }).from(cardSettlement).where(eq(cardSettlement.householdId, householdId));
  const debits = await db
    .select({ tx: transaction })
    .from(transaction)
    .innerJoin(account, eq(account.id, transaction.accountId))
    .where(
      and(
        eq(transaction.householdId, householdId),
        eq(account.type, "bank"),
        lt(transaction.amount, 0n),
        eq(transaction.isManuallyEdited, false),
        isNull(transaction.supersededById),
        or(eq(transaction.kind, "card_settlement"), eq(transaction.categoryId, unitemizedCategoryId)),
        sql`${transaction.id} not in ${settled}`,
      ),
    );

  const used = new Set<string>();
  const paidBills = new Set<string>();
  const summary: SettlementSummary = { matched: 0, unitemized: 0, needsReview: 0 };
  const asBill = (b: typeof cardBill.$inferSelect): CardBill => ({ id: b.id, institution: cardById.get(b.cardAccountId)!.institution, postingDate: b.postingDate, totalMinor: b.total });
  const asDebit = (t: typeof transaction.$inferSelect) => ({ id: t.id, date: t.purchaseDate, amountMinor: t.amount, description: t.descriptionRaw });
  const markSettled = (debitId: string, reason: string) =>
    db
      .update(transaction)
      .set({
        kind: "card_settlement",
        categoryId: null,
        classificationSource: "settlement",
        classificationConfidence: 1,
        classificationReason: reason,
        needsReview: false,
        reviewReason: null,
        updatedAt: new Date(),
      })
      .where(eq(transaction.id, debitId));

  // 1. pay off imported bills, largest first (least ambiguous)
  for (const { bill } of openBills.sort((a, b) => (b.bill.total > a.bill.total ? 1 : -1))) {
    const card = cardById.get(bill.cardAccountId)!;
    const pool = debits
      .map((d) => d.tx)
      .filter((t) => !used.has(t.id) && (!card.settlesToAccountId || t.accountId === card.settlesToAccountId));
    const [match] = matchSettlements(
      [{ id: bill.id, institution: card.institution, postingDate: bill.postingDate, totalMinor: bill.total }],
      pool.map((t) => ({ id: t.id, date: t.purchaseDate, amountMinor: t.amount, description: t.descriptionRaw })),
    );
    if (!match) continue;
    used.add(match.debitId);
    paidBills.add(bill.id);
    summary.matched++;
    await db.insert(cardSettlement).values({ householdId, cardBillId: bill.id, bankTransactionId: match.debitId, dayDiff: Math.round(match.dayDiff) });
    await markSettled(match.debitId, `pays ${card.name} bill of ${bill.postingDate}`);
  }

  // 1b. one debit paying several bills of its issuer at once
  const leftBills = () => openBills.map((b) => b.bill).filter((b) => !paidBills.has(b.id));
  const combined = matchCombinedSettlements(leftBills().map(asBill), debits.map((d) => d.tx).filter((t) => !used.has(t.id)).map(asDebit));
  for (const debitId of new Set(combined.map((m) => m.debitId))) {
    const parts = combined.filter((m) => m.debitId === debitId);
    for (const m of parts) {
      paidBills.add(m.billId);
      await db.insert(cardSettlement).values({ householdId, cardBillId: m.billId, bankTransactionId: debitId, dayDiff: Math.round(m.dayDiff) });
    }
    used.add(debitId);
    summary.matched += parts.length;
    await markSettled(debitId, `pays ${parts.length} card bills`);
  }

  // 2. everything else: a near miss of an imported bill, or a bill without an imported statement
  for (const { tx } of debits.filter((d) => !used.has(d.tx.id))) {
    const explicit = cards.filter((c) => c.billDescriptionPattern && new RegExp(c.billDescriptionPattern, "u").test(tx.descriptionRaw));
    // a debit recognized as a specific card's bill by its pattern is that card's, not a near miss
    const near = explicit.length === 0 ? nearMissBill(asDebit(tx), leftBills().map(asBill)) : null;
    if (near) {
      const billCard = cardById.get(leftBills().find((b) => b.id === near.id)!.cardAccountId)!;
      summary.needsReview++;
      await db
        .update(transaction)
        .set({
          kind: "card_settlement",
          categoryId: null,
          classificationSource: "settlement",
          classificationConfidence: 0.5,
          classificationReason: `nearly equals the ${billCard.name} bill of ${near.postingDate}`,
          needsReview: true,
          reviewReason: `bank charge ${(Number(-tx.amount) / 100).toFixed(2)} differs from the ${billCard.name} statement total ${(Number(near.totalMinor) / 100).toFixed(2)}`,
          updatedAt: new Date(),
        })
        .where(eq(transaction.id, tx.id));
      continue;
    }
    const issuer = issuerForDescription(tx.descriptionRaw);
    const candidates = explicit.length > 0 ? explicit : cards.filter((c) => !c.billDescriptionPattern && c.institution === issuer);
    const card = candidates.length === 1 ? candidates[0]! : null;
    // a tracked card's statement is expected: ask for it; an untracked card's bill is final as-is
    const needsReview = !card || card.tracksStatements;
    const reviewReason = !card
      ? candidates.length > 1
        ? `card bill: which card? (${candidates.map((c) => c.name).join(", ")})`
        : "card bill from an unknown card"
      : card.tracksStatements
        ? `statement for ${card.name} not imported yet`
        : null;
    summary.unitemized++;
    if (needsReview) summary.needsReview++;
    await db
      .update(transaction)
      .set({
        kind: "expense",
        categoryId: unitemizedCategoryId,
        memberId: card ? card.ownerMemberId : tx.memberId,
        isShared: card ? card.ownerMemberId === null : tx.isShared,
        classificationSource: "settlement",
        classificationConfidence: needsReview ? 0.5 : 0.9,
        classificationReason: card ? `${card.name} bill (not itemized)` : "card bill (not itemized)",
        needsReview,
        reviewReason,
        updatedAt: new Date(),
      })
      .where(eq(transaction.id, tx.id));
  }
  return summary;
}

/** Ids of bank debits currently linked to a bill (useful for tests and the UI). */
export async function settledDebitIds(db: Db, householdId: string): Promise<string[]> {
  const rows = await db.select({ id: cardSettlement.bankTransactionId }).from(cardSettlement).where(eq(cardSettlement.householdId, householdId));
  return rows.map((r) => r.id);
}

