import type { ParsedTransaction, SourceAdapter, StatementTotal } from "../types.js";
import { buildRecords, cells, stripPrintChrome, findHeader, groupLines, lineText, type Column, type Line } from "../pdf/layout.js";
import { charge, money } from "../amounts.js";
import { parseIlDate, parseInstallment } from "../dates.js";

const HEADER = ["ת.עסקה", "שם בית העסק", "קטגוריה", "כרטיס", "סוג עסקה", "סכום"];
const NAMES = ["date", "merchant", "category", "card", "type", "charged"] as const;
const DATE = /^\d{2}\.\d{2}\.\d{2}$/;

export const maxPdf: SourceAdapter = {
  id: "max-pdf",
  version: 1,
  format: "pdf",
  detect: (c) => c.format === "pdf" && c.text.includes("max.co.il") && c.text.includes("פירוט החיובים"),
  parse(content) {
    if (content.format !== "pdf") throw new Error("expected pdf");
    const lines = stripPrintChrome(groupLines(content.pages));
    const transactions: ParsedTransaction[] = [];
    const totals: StatementTotal[] = [];
    let columns: Column[] | null = null;
    let group: { label: string; postingDate: string; amount: string; lines: Line[]; pending: boolean } | null = null;
    let rowIndex = 0;

    const flush = () => {
      if (!group || !columns) return;
      const rows: number[] = [];
      for (const rec of buildRecords(group.lines, (l) => DATE.test(l.items[0]?.s ?? ""), 40)) {
        const c = cells(rec.lines, columns);
        const tx: ParsedTransaction = {
          rowIndex: rowIndex++,
          raw: c,
          purchaseDate: parseIlDate(c.date!),
          postingDate: group.postingDate,
          description: c.merchant!,
          amount: charge(c.charged!),
          categoryHint: c.category || undefined,
          typeHint: c.type || undefined,
          installment: parseInstallment(c.type),
          cardLast4: c.card || undefined,
          status: group.pending ? "pending" : "posted",
        };
        transactions.push(tx);
        rows.push(tx.rowIndex);
      }
      if (!group.pending) totals.push({ label: group.label, postingDate: group.postingDate, amount: money(group.amount), rowIndices: rows });
      group = null;
    };

    for (const line of lines) {
      const text = lineText(line);
      const header = findHeader(line, HEADER);
      if (header) {
        columns = NAMES.map((name, i) => ({ name, right: header[i]!, kind: name === "charged" || name === "date" || name === "card" ? "number" : "text" }));
        continue;
      }
      const due = text.match(/^חיוב ב :?(\d{2}\.\d{2}\.\d{4}) (₪[\d,.-]+)/);
      if (due) {
        flush();
        group = { label: text, postingDate: parseIlDate(due[1]!), amount: due[2]!, lines: [], pending: false };
        continue;
      }
      if (/טרם נקלטו/.test(text) && !text.includes("•")) {
        flush();
        group = { label: text, postingDate: "", amount: "0", lines: [], pending: true };
        continue;
      }
      if (/^₪[\d,.]+$/.test(text) || text.startsWith("סה״כ עסקאות")) {
        flush();
        continue;
      }
      if (group && columns) group.lines.push(line);
    }
    flush();

    const cards = new Set(transactions.map((t) => t.cardLast4).filter(Boolean));
    return {
      adapter: this.id,
      adapterVersion: this.version,
      account: { type: "credit_card", institution: "max", cardLast4: cards.size === 1 ? [...cards][0] : undefined },
      transactions,
      totals,
      warnings: cards.size > 1 ? [`File covers ${cards.size} cards: ${[...cards].join(", ")}`] : [],
    };
  },
};
