/** Calendar months as "YYYY-MM" strings. */

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** First day of the month and first day of the next, for half-open date ranges. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` };
}

/** Inclusive list of months from `first` to `last`. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = first; m <= last; m = shiftMonth(m, 1)) out.push(m);
  return out;
}
