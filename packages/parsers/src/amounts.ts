import { parseAmount, type Money } from "@ft/core";

const SYMBOLS: Record<string, string> = { "₪": "ILS", 'ש"ח': "ILS", "$": "USD", "€": "EUR", "£": "GBP" };

export function currencyFromSymbol(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  return SYMBOLS[t] ?? (/^[A-Z]{3}$/.test(t) ? t : undefined);
}

/** Finds a currency symbol inside free text like "$532.77" or "₪70.00". */
export function currencyIn(s: string): string | undefined {
  for (const [sym, code] of Object.entries(SYMBOLS)) if (s.includes(sym)) return code;
  return undefined;
}

/** Accepts a spreadsheet number or statement text ("1,234.56", "₪70.00", "440₪"). */
export function money(value: string | number, currency = "ILS"): Money {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${value}`);
    return parseAmount(value.toFixed(2), currency);
  }
  return parseAmount(value.replace(/[₪$€£]|ש"ח/g, ""), currency);
}

/** Card statements print charges as positive numbers; the ledger stores money out as negative. */
export function charge(value: string | number, currency = "ILS"): Money {
  const m = money(value, currency);
  return { minor: -m.minor, currency: m.currency };
}
