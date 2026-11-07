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

const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Bank debits that pay several bills at once: one card company charging, in a single debit,
 * the bills of two of its cards, or a card's domestic and abroad sections. A debit is matched to
 * a set of 2-`maxBills` open bills of the issuer its description names, dated within `maxDays`,
 * whose totals add up to the debit exactly. Run it on what single matching left unmatched.
 */
export function matchCombinedSettlements(bills: CardBill[], debits: BankDebit[], maxDays = 3, maxBills = 4): SettlementMatch[] {
  const used = new Set<string>();
  const matches: SettlementMatch[] = [];
  for (const d of [...debits].sort((a, b) => (a.amountMinor < b.amountMinor ? -1 : 1))) {
    const issuer = issuerForDescription(d.description);
    if (!issuer) continue; // combining needs the debit to name the issuer
    const pool = bills.filter((b) => !used.has(b.id) && b.institution === issuer && daysApart(b.postingDate, d.date) <= maxDays);
    const target = -d.amountMinor;
    let best: CardBill[] | null = null;
    const search = (start: number, chosen: CardBill[], sum: bigint) => {
      if (sum === target && chosen.length >= 2) {
        const worst = (set: CardBill[]) => Math.max(...set.map((b) => daysApart(b.postingDate, d.date)));
        if (!best || chosen.length < best.length || (chosen.length === best.length && worst(chosen) < worst(best))) best = [...chosen];
        return;
      }
      if (chosen.length === maxBills || sum >= target) return;
      for (let i = start; i < pool.length; i++) search(i + 1, [...chosen, pool[i]!], sum + pool[i]!.totalMinor);
    };
    search(0, [], 0n);
    const chosen = best as CardBill[] | null;
    if (!chosen) continue;
    for (const b of chosen) {
      used.add(b.id);
      matches.push({ billId: b.id, debitId: d.id, dayDiff: daysApart(b.postingDate, d.date), issuerMatched: true });
    }
  }
  return matches;
}

/**
 * An open bill of the debit's issuer that nearly equals it (within ₪20 or 2%, within `maxDays`):
 * almost certainly the same payment with a small difference (a fee, a rounding, a late
 * adjustment). Counting both would count the money twice, so the caller asks the user instead.
 */
export function nearMissBill(debit: BankDebit, bills: CardBill[], maxDays = 5): CardBill | null {
  const issuer = issuerForDescription(debit.description);
  if (!issuer) return null;
  const amount = -debit.amountMinor;
  const close = bills
    .filter((b) => b.institution === issuer && daysApart(b.postingDate, debit.date) <= maxDays)
    .map((b) => ({ b, diff: b.totalMinor > amount ? b.totalMinor - amount : amount - b.totalMinor }))
    .filter(({ b, diff }) => diff <= 2000n || diff * 50n <= b.totalMinor)
    .sort((x, y) => (x.diff < y.diff ? -1 : 1));
  return close[0]?.b ?? null;
}
