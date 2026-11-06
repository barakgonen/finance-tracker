import { createHash } from "node:crypto";
import { normalizeDescription, similarity } from "./merchant.js";

export interface FingerprintInput {
  accountId: string;
  /** ISO date YYYY-MM-DD */
  purchaseDate: string;
  amountMinor: bigint;
  currency: string;
  descriptionRaw: string;
  /**
   * Installment number. Each installment of one purchase is billed in a different month with the
   * same purchase date, amount and merchant; only this tells them apart.
   */
  installmentNo?: number;
}

/**
 * Assigns deterministic fingerprints to a batch of rows from one account.
 * Identical rows on the same day (e.g. two identical coffees) are disambiguated by their
 * occurrence index, so re-importing the same or an overlapping statement yields the same
 * fingerprints and is rejected by the (account_id, fingerprint) unique index.
 */
export function fingerprintBatch(rows: FingerprintInput[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = [
      r.accountId,
      r.purchaseDate,
      r.amountMinor.toString(),
      r.currency,
      normalizeDescription(r.descriptionRaw).key,
      // appended only when present, so fingerprints of ordinary rows are unaffected
      ...(r.installmentNo !== undefined ? [`inst${r.installmentNo}`] : []),
    ].join("|");
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return createHash("sha256").update(`${base}|${occurrence}`).digest("hex");
  });
}

export interface PendingCandidate {
  id: string;
  purchaseDate: string;
  amountMinor: bigint;
  descriptionRaw: string;
}

/**
 * Finds the pending transaction that a newly posted row supersedes:
 * same amount, within `maxDays`, and similar description. Returns the best match or null.
 */
export function matchPendingToPosted(
  posted: Omit<PendingCandidate, "id">,
  pending: PendingCandidate[],
  maxDays = 3,
  minSimilarity = 0.5,
): string | null {
  const postedKey = normalizeDescription(posted.descriptionRaw).key;
  let best: { id: string; score: number } | null = null;
  for (const p of pending) {
    if (p.amountMinor !== posted.amountMinor) continue;
    if (Math.abs(daysBetween(p.purchaseDate, posted.purchaseDate)) > maxDays) continue;
    const score = similarity(postedKey, normalizeDescription(p.descriptionRaw).key);
    if (score >= minSimilarity && (!best || score > best.score)) best = { id: p.id, score };
  }
  return best?.id ?? null;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}
