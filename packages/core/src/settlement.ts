// Matches a card's monthly bill to the bank debit that paid it, so the debit can be marked
// `card_settlement` and excluded from spending (the card's own transactions already count).

export interface CardBill {
  id: string;
  institution: string;
  /** Date the bill is charged to the bank (YYYY-MM-DD). */
  postingDate: string;
  /** Printed bill total, positive minor units. */
  totalMinor: bigint;
}

export interface BankDebit {
  id: string;
  date: string;
  /** Signed: a settlement is money out, so negative. */
  amountMinor: bigint;
  description: string;
}

export interface SettlementMatch {
  billId: string;
  debitId: string;
  dayDiff: number;
  issuerMatched: boolean;
}

/** How each issuer's debit is labelled on Israeli bank statements. */
const ISSUER_PATTERNS: Record<string, RegExp> = {
  isracard: /ישראכרט|אמריקן אקספרס|isracard/i,
  cal: /כרטיסי אשראי|כאל|cal/i,
  max: /מקס איט|לאומי קארד|max/i,
};

/** Which card issuer a bank debit description refers to, if any. */
export function issuerForDescription(description: string): string | undefined {
  return Object.entries(ISSUER_PATTERNS).find(([, re]) => re.test(description))?.[0];
}

export function matchSettlements(bills: CardBill[], debits: BankDebit[], maxDays = 3): SettlementMatch[] {
  const used = new Set<string>();
  const matches: SettlementMatch[] = [];
  // largest bills first: they are the least ambiguous
  for (const bill of [...bills].sort((a, b) => (b.totalMinor > a.totalMinor ? 1 : -1))) {
    const pattern = ISSUER_PATTERNS[bill.institution];
    let best: SettlementMatch | null = null;
    for (const d of debits) {
      if (used.has(d.id) || -d.amountMinor !== bill.totalMinor) continue;
      const dayDiff = Math.abs(Date.parse(d.date) - Date.parse(bill.postingDate)) / 86_400_000;
      if (dayDiff > maxDays) continue;
      const issuerMatched = pattern?.test(d.description) ?? false;
      const better =
        !best ||
        (issuerMatched && !best.issuerMatched) ||
        (issuerMatched === best.issuerMatched && dayDiff < best.dayDiff);
      if (better) best = { billId: bill.id, debitId: d.id, dayDiff, issuerMatched };
    }
    if (best) {
      used.add(best.debitId);
      matches.push(best);
    }
  }
  return matches;
}
