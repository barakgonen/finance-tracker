import type { ParsedStatement, ParsedTransaction, SourceAdapter, StatementTotal } from "../types.js";
import type { CellValue } from "../xlsx/reader.js";
import { charge, currencyFromSymbol, money } from "../amounts.js";
import { parseIlDate, parseInstallment } from "../dates.js";

const H = {
  date: "תאריך עסקה",
  merchant: "שם בית העסק",
  category: "קטגוריה",
  last4: "4 ספרות אחרונות של כרטיס האשראי",
  type: "סוג עסקה",
  charged: "סכום חיוב",
  chargedCurrency: "מטבע חיוב",
  original: "סכום עסקה מקורי",
  originalCurrency: "מטבע עסקה מקורי",
  chargeDate: "תאריך חיוב",
  notes: "הערות",
} as const;

const str = (v: CellValue | undefined) => (v == null ? "" : String(v).trim());

export const maxXlsx: SourceAdapter = {
  id: "max-xlsx",
  version: 2, // v2: bill totals carry their posting date
  format: "xlsx",
  detect: (c) => c.format === "xlsx" && c.sheets.some((s) => s.rows.some((r) => r.includes(H.last4))),
  parse(content) {
    if (content.format !== "xlsx") throw new Error("expected xlsx");
    const transactions: ParsedTransaction[] = [];
    const totals: StatementTotal[] = [];
    const warnings: string[] = [];
    let rowIndex = 0;

    for (const sheet of content.sheets) {
      const headerAt = sheet.rows.findIndex((r) => r.includes(H.date) && r.includes(H.charged));
      if (headerAt < 0) continue;
      const header = sheet.rows[headerAt]!.map(str);
      const col = (name: string) => header.indexOf(name);
      const pending = /טרם נקלטו|אושרו/.test(sheet.name);
      const sheetRows: number[] = [];

      for (let i = headerAt + 1; i < sheet.rows.length; i++) {
        const row = sheet.rows[i]!;
        const first = str(row[0]);
        if (!first) continue;
        if (first === "סך הכל") {
          const totalText = str(sheet.rows[i + 1]?.[0]);
          if (totalText && !pending) {
            // the sheet prints no bill date; every row carries it as "תאריך חיוב"
            const dates = new Set(sheetRows.map((r) => transactions[r]!.postingDate));
            const postingDate = dates.size === 1 ? [...dates][0] : undefined;
            if (!postingDate) warnings.push(`${sheet.name}: rows have ${dates.size} different billing dates; total not dated`);
            totals.push({ label: `${sheet.name} ${totalText}`, postingDate, amount: money(totalText), rowIndices: sheetRows });
          }
          break;
        }
        const raw = Object.fromEntries(header.map((h, j) => [h, str(row[j])]).filter(([h]) => h));
        const currency = currencyFromSymbol(raw[H.chargedCurrency]) ?? "ILS";
        const origCurrency = currencyFromSymbol(raw[H.originalCurrency]);
        const notes = raw[H.notes] || undefined;
        const inst = parseInstallment(notes);
        const original = raw[H.original] && origCurrency ? money(Number(row[col(H.original)]), origCurrency) : undefined;
        const tx: ParsedTransaction = {
          rowIndex: rowIndex++,
          raw: { sheet: sheet.name, ...raw },
          purchaseDate: parseIlDate(raw[H.date]!),
          postingDate: raw[H.chargeDate] ? parseIlDate(raw[H.chargeDate]) : undefined,
          description: raw[H.merchant]!,
          amount: charge(Number(row[col(H.charged)] ?? 0), currency),
          originalAmount: original && origCurrency !== currency ? original : undefined,
          categoryHint: raw[H.category] || undefined,
          typeHint: raw[H.type] || undefined,
          installment: inst && { ...inst, originalAmount: original },
          cardLast4: raw[H.last4] || undefined,
          status: pending ? "pending" : "posted",
          notes,
        };
        transactions.push(tx);
        sheetRows.push(tx.rowIndex);
      }
    }

    const cards = new Set(transactions.map((t) => t.cardLast4).filter(Boolean));
    if (cards.size > 1) warnings.push(`File covers ${cards.size} cards: ${[...cards].join(", ")}`);
    return {
      adapter: this.id,
      adapterVersion: this.version,
      account: { type: "credit_card", institution: "max", cardLast4: cards.size === 1 ? [...cards][0] : undefined },
      transactions,
      totals,
      warnings,
    } satisfies ParsedStatement;
  },
};
