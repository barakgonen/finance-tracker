import type { ParsedTransaction, SourceAdapter, StatementTotal } from "../types.js";
import { buildRecords, cells, findHeader, groupLines, lineText, type Column, type Line } from "../pdf/layout.js";
import { charge, currencyIn, money } from "../amounts.js";
import { IL_DATE, parseIlDate, parseInstallment } from "../dates.js";

const DOMESTIC_HEADER = ["תאריך", "כרטיס", "שם", "ענף", "סכום", "סכום", "פירוט"];
const DOMESTIC_COLS = ["date", "cardType", "merchant", "category", "amount", "charged", "details"] as const;
const ABROAD_HEADER = ["תאריך", "סוג", "שם", "סכום", "סכום", "תאריך", "שער", "סכום", "סכום"];
const ABROAD_COLS = ["date", "type", "merchant", "original", "usd", "fxDate", "fxRate", "fee", "charged"] as const;
const TEXT_COLS = new Set(["cardType", "merchant", "category", "details", "type"]);

interface Section {
  kind: "domestic" | "abroad";
  columns: Column[];
  lines: Line[];
}

function toColumns(names: readonly string[], rights: number[]): Column[] {
  return names.map((name, i) => ({ name, right: rights[i]!, kind: TEXT_COLS.has(name) ? "text" : "number" }));
}

const isTotal = (l: Line) => /^סה"כ חיוב לתאריך/.test(lineText(l));

export const isracardPdf: SourceAdapter = {
  id: "isracard-pdf",
  version: 1,
  format: "pdf",
  detect: (c) => c.format === "pdf" && /isracard/i.test(c.text) && c.text.includes("פרוט פעולותיך"),
  parse(content) {
    if (content.format !== "pdf") throw new Error("expected pdf");
    const lines = groupLines(content.pages);
    const transactions: ParsedTransaction[] = [];
    const totals: StatementTotal[] = [];
    const warnings: string[] = [];
    let section: Section | null = null;
    let rowIndex = 0;

    const closeSection = (totalLine: Line) => {
      if (!section) return;
      const text = lineText(totalLine);
      const postingDate = parseIlDate(text.match(/\d{2}\/\d{2}\/\d{2}/)![0]);
      const isAnchor = (l: Line) => IL_DATE.test(l.items[0]?.s ?? "");
      // lines before the first row are the header's wrapped second/third lines
      const first = section.lines.findIndex(isAnchor);
      const body = first < 0 ? [] : section.lines.slice(first);
      const rows: number[] = [];
      for (const { anchor, lines: recLines } of buildRecords(body, isAnchor)) {
        const rest = recLines.filter((l) => l !== anchor);
        const c = cells([anchor], section.columns);
        const extra = cells(rest, section.columns);
        const raw: Record<string, string> = { section: section.kind, ...c };
        let description = c.merchant!;
        if (section.kind === "abroad") raw.city = extra.merchant ?? "";
        else if (extra.merchant) description = `${description} ${extra.merchant}`;

        const tx: ParsedTransaction = {
          rowIndex: rowIndex++,
          raw,
          purchaseDate: parseIlDate(c.date!),
          postingDate,
          description,
          amount: charge(c.charged!),
          status: "posted",
        };
        if (section.kind === "domestic") {
          tx.typeHint = c.cardType || undefined;
          tx.categoryHint = c.category || undefined;
          tx.notes = c.details || undefined;
          const inst = parseInstallment(c.details);
          if (inst) tx.installment = { ...inst, originalAmount: money(c.amount!) };
        } else {
          tx.typeHint = c.type || undefined;
          const cur = currencyIn(c.original ?? "");
          if (cur && cur !== "ILS") tx.originalAmount = money(c.original!, cur);
          if (c.fee && money(c.fee).minor !== 0n) tx.notes = `fee ${c.fee}`;
        }
        transactions.push(tx);
        rows.push(tx.rowIndex);
      }
      const amountText = totalLine.items[totalLine.items.length - 1]!.s;
      totals.push({ label: text, postingDate, amount: money(amountText), rowIndices: rows });
      section = null;
    };

    for (const line of lines) {
      const domestic = findHeader(line, DOMESTIC_HEADER);
      const abroad = !domestic && findHeader(line, ABROAD_HEADER);
      if (domestic || abroad) {
        // a header repeated on a continuation page keeps the open section
        const kind = domestic ? "domestic" : "abroad";
        const columns = domestic ? toColumns(DOMESTIC_COLS, domestic) : toColumns(ABROAD_COLS, abroad as number[]);
        if (section && section.kind === kind) section.columns = columns;
        else section = { kind, columns, lines: [] };
        continue;
      }
      if (!section) continue;
      if (isTotal(line)) closeSection(line);
      else section.lines.push(line);
    }
    if (section) warnings.push("Section without a closing total; its rows were not imported");

    const text = content.text;
    return {
      adapter: this.id,
      adapterVersion: this.version,
      account: {
        type: "credit_card",
        institution: "isracard",
        cardLast4: text.match(/שמסתיים בספרות:\s*(\d{4})/)?.[1],
        bankAccount: text.match(/\d{2}-\d{3}-\d{7}\/\d{3}/)?.[0],
      },
      transactions,
      totals,
      warnings,
    };
  },
};
