/** Parses DD/MM/YY, DD/MM/YYYY, DD.MM.YY, DD-MM-YYYY into YYYY-MM-DD. */
export function parseIlDate(input: string): string {
  const m = input.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!m) throw new Error(`Unparseable date: "${input}"`);
  const [, d, mo, y] = m;
  const year = y!.length === 2 ? 2000 + Number(y) : Number(y);
  const iso = `${year}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  if (Number.isNaN(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso) {
    throw new Error(`Invalid date: "${input}"`);
  }
  return iso;
}

export const IL_DATE = /^\d{1,2}[./-]\d{1,2}[./-](\d{2}|\d{4})$/;

/** "תשלום 2 מתוך 8" -> { no: 2, total: 8 } */
export function parseInstallment(text: string | undefined): { no: number; total: number } | undefined {
  const m = text?.match(/תשלום\s*(\d+)\s*מתוך\s*(\d+)/);
  return m ? { no: Number(m[1]), total: Number(m[2]) } : undefined;
}
