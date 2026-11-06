// Money is always integer minor units (agorot for ILS). Never use floats for stored amounts.

export type Currency = string; // ISO 4217, e.g. "ILS"

export interface Money {
  minor: bigint;
  currency: Currency;
}

const MINOR_DIGITS: Record<string, number> = { ILS: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0 };

export function minorDigits(currency: Currency): number {
  return MINOR_DIGITS[currency] ?? 2;
}

/**
 * Parse an amount as it appears in Israeli statements: "1,234.56", "-1,234.56",
 * "1,234.56-" (trailing minus), "(1,234.56)", "₪ 1,234.56".
 */
export function parseAmount(input: string, currency: Currency = "ILS"): Money {
  let s = input.trim().replace(/[₪$€£\s‎‏]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Unparseable amount: "${input}"`);
  }
  const digits = minorDigits(currency);
  const [whole = "0", frac = ""] = s.split(".");
  if (frac.length > digits && /[1-9]/.test(frac.slice(digits))) {
    throw new Error(`Amount "${input}" has more precision than ${currency} allows`);
  }
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt((frac + "0".repeat(digits)).slice(0, digits) || "0");
  return { minor: negative ? -minor : minor, currency };
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function sum(items: Money[], currency: Currency = "ILS"): Money {
  return items.reduce((acc, m) => add(acc, m), { minor: 0n, currency });
}

export function negate(m: Money): Money {
  return { minor: -m.minor, currency: m.currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function toDecimalString(m: Money): string {
  const digits = minorDigits(m.currency);
  const neg = m.minor < 0n;
  const abs = neg ? -m.minor : m.minor;
  if (digits === 0) return `${neg ? "-" : ""}${abs}`;
  const base = 10n ** BigInt(digits);
  return `${neg ? "-" : ""}${abs / base}.${(abs % base).toString().padStart(digits, "0")}`;
}

export function format(m: Money, locale = "he-IL"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency }).format(
    Number(toDecimalString(m)),
  );
}
