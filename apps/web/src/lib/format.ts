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

/** Axis ticks: ₪0, ₪500, ₪12K, ₪1.2M. */
export function compactMoney(minor: bigint | number): string {
  const v = Math.abs(Number(minor) / 100);
  const sign = Number(minor) < 0 ? "−" : "";
  if (v >= 1_000_000) return `${sign}₪${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1000) return `${sign}₪${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}K`;
  return `${sign}₪${Math.round(v)}`;
}

/** Signed change vs a comparison value, as text: "▲ 12%" / "▼ 5%" / "—". */
export function change(current: bigint, previous: bigint | null): { text: string; dir: "up" | "down" | "flat" | "none" } {
  if (previous === null || previous === 0n) return { text: "—", dir: "none" };
  const ratio = (Number(current) - Number(previous)) / Math.abs(Number(previous));
  if (Math.abs(ratio) < 0.005) return { text: "ללא שינוי", dir: "flat" };
  return { text: `${ratio > 0 ? "▲" : "▼"} ${Math.round(Math.abs(ratio) * 100)}%`, dir: ratio > 0 ? "up" : "down" };
}

const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
export function monthName(month: string, short = false): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const name = HE_MONTHS[m - 1]!;
  return short ? name.slice(0, 3) + "׳" : `${name} ${y}`;
}
