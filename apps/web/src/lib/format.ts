const ils = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });
const ilsWhole = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });

/** Minor units (agorot) -> "‏1,234.56 ‏₪". Number conversion is display-only. */
export function money(minor: bigint | number, opts: { whole?: boolean; signed?: boolean } = {}): string {
  const value = Number(minor) / 100;
  const text = (opts.whole ? ilsWhole : ils).format(Math.abs(value));
  if (value < 0) return `−${text}`;
  return opts.signed && value > 0 ? `+${text}` : text;
}

export function date(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
