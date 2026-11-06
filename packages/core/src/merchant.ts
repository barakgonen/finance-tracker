// Normalizes raw transaction descriptions into a stable key used for merchant alias lookup.

/** Payment processors / wallets that wrap the real merchant name. */
const PROCESSOR_PREFIXES = [
  /^paypal\s*\*\s*/i,
  /^pp\s*\*\s*/i,
  /^sq\s*\*\s*/i,
  /^sumup\s*\*\s*/i,
  /^google\s*\*\s*/i,
  /^apple\.com\/bill\s*/i,
];

/** Wallet / P2P transfers: the counterparty is a person, not a merchant. */
const P2P_PATTERNS = [/\bbit\b/i, /ביט/, /paybox/i, /פייבוקס/];

export interface NormalizedDescription {
  /** Key for alias lookup: lowercased, punctuation/digits stripped, whitespace collapsed. */
  key: string;
  /** Processor that was stripped, if any (e.g. "paypal"). */
  processor: string | null;
  isP2P: boolean;
}

export function normalizeDescription(raw: string): NormalizedDescription {
  let s = raw.normalize("NFKC").replace(/[‎‏‪-‮]/g, "").trim();
  const isP2P = P2P_PATTERNS.some((p) => p.test(s));

  let processor: string | null = null;
  for (const p of PROCESSOR_PREFIXES) {
    const m = s.match(p);
    if (m) {
      processor = m[0].replace(/[\s*]/g, "").toLowerCase();
      s = s.slice(m[0].length);
      break;
    }
  }

  const key = s
    .toLowerCase()
    // Hebrew quotes/gershayim and general punctuation
    .replace(/["'`״׳.,\-_*#/\\()[\]{}:;!?|+]/g, " ")
    // branch numbers, terminal ids, dates
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { key, processor, isP2P };
}

/** Token-set Jaccard similarity, used for nearest-neighbour categorization and fuzzy dedup. */
export function similarity(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
