import type { ParsedTransaction, SourceAdapter } from "../types.js";
import { buildRecords, cells, stripPrintChrome, columnFor, findHeader, groupLines, lineText, type Column, type Line } from "../pdf/layout.js";
import { money } from "../amounts.js";
import { parseIlDate } from "../dates.js";

const HEADER = ["תאריך", "תאריך ערך", "תיאור", "אסמכתא", "בחובה", "בזכות", 'היתרה בש"ח'];
const NAMES = ["date", "valueDate", "description", "reference", "debit", "credit", "balance"] as const;
const DATE = /^\d{2}\/\d{2}\/\d{4}$/;

export const leumiPdf: SourceAdapter = {
  id: "leumi-pdf",
  version: 1,
  format: "pdf",
  detect: (c) => c.format === "pdf" && c.text.includes("בנק לאומי") && c.text.includes("תנועות בחשבון"),
  parse(content) {
    if (content.format !== "pdf") throw new Error("expected pdf");
    const lines = stripPrintChrome(groupLines(content.pages));
    const transactions: ParsedTransaction[] = [];
    // the header is printed on the first page only; later pages reuse its columns
    let columns: Column[] | null = null;
    let rowIndex = 0;
    for (const page of content.pages.map((p) => p.page)) {
      const pageLines = lines.filter((l) => l.page === page);
      const headerLine = pageLines.find((l) => findHeader(l, HEADER));
      if (headerLine) {
        const h = findHeader(headerLine, HEADER)!;
        columns = NAMES.map((name, i) => ({ name, right: h[i]!, kind: name === "description" ? "text" : "number" }));
        // the description column's left limit: the leftmost description text in the table body
        const desc = columns.find((c) => c.name === "description")!;
        const tableLines = lines.filter((l) => l.page > page || (l.page === page && l.y < headerLine.y));
        const lefts = tableLines.flatMap((l) => l.items.filter((it) => columnFor(it, columns!) === desc).map((it) => it.x));
        desc.fullWidthX = Math.min(...lefts) + 6;
      }
      if (!columns) continue;
      const cols = columns;
      const body = headerLine ? pageLines.filter((l) => l.y < headerLine.y) : pageLines;
      const isAnchor = (l: Line) => DATE.test(cells([l], cols).date ?? "");
      for (const rec of buildRecords(body, isAnchor)) {
        const c = cells(rec.lines, cols);
        const debit = money(c.debit || "0");
        const credit = money(c.credit || "0");
        transactions.push({
          rowIndex: rowIndex++,
          raw: c,
          purchaseDate: parseIlDate(c.date!),
          postingDate: c.valueDate ? parseIlDate(c.valueDate) : undefined,
          description: c.description!,
          amount: { minor: credit.minor - debit.minor, currency: "ILS" },
          balance: c.balance ? money(c.balance) : undefined,
          reference: c.reference || undefined,
          status: "posted",
        });
      }
    }

    const accountLine = lines.find((l) => lineText(l).startsWith("מס' חשבון"));
    const label = accountLine?.items.find((i) => i.s === "מס' חשבון");
    const account = accountLine?.items
      .filter((i) => label && i.x < label.x && i.s !== ":")
      .sort((a, b) => a.x - b.x)
      .map((i) => i.s)
      .join("");

    return {
      adapter: this.id,
      adapterVersion: this.version,
      account: { type: "bank", institution: "leumi", bankAccount: account || undefined },
      transactions,
      totals: [],
      warnings: columns ? [] : ["No transaction table header found"],
    };
  },
};
