import type { ParsedTransaction, SourceAdapter } from "../types.js";
import { buildRecords, cells, stripPrintChrome, groupLines, lineText, type Column, type Line } from "../pdf/layout.js";
import { charge, currencyIn, money } from "../amounts.js";
import { parseIlDate, parseInstallment } from "../dates.js";

// Cal's PDF is a browser print of the web statement and has no table header, so the
// column right edges are fixed. Reconciliation against the printed total guards drift.
const COLUMNS: Column[] = [
  { name: "date", right: 530, kind: "number" },
  { name: "description", right: 472, kind: "text" },
  { name: "notes", right: 340, kind: "text" },
  { name: "charged", right: 140, kind: "number" },
];
const DATE = /^\d{2}\/\d{2}\/\d{2}$/;
const isAnchor = (l: Line) => l.items.some((i) => i.x >= 470 && DATE.test(i.s));

export const calPdf: SourceAdapter = {
  id: "cal-pdf",
  version: 1,
  format: "pdf",
  detect: (c) => c.format === "pdf" && (c.text.includes("cal-online.co.il") || c.text.includes("פירוט עסקאות וחיובים לכרטיס")),
  parse(content) {
    if (content.format !== "pdf") throw new Error("expected pdf");
    const lines = stripPrintChrome(groupLines(content.pages));
    const totalLine = lines.find((l) => lineText(l).startsWith("עסקאות לחיוב ב"));
    if (!totalLine) throw new Error("Cal PDF: billing total line not found");
    const dateItem = totalLine.items.find((i) => /\d{2}\/\d{2}\/\d{2}/.test(i.s))!;
    const postingDate = parseIlDate(dateItem.s.match(/\d{2}\/\d{2}\/\d{2}/)![0]);
    const totalText = totalLine.items
      .filter((i) => i.x < dateItem.x && /[\d,.]/.test(i.s))
      .sort((a, b) => a.x - b.x)
      .map((i) => i.s)
      .join("");

    const body = lines.filter((l) => l.page > totalLine.page || (l.page === totalLine.page && l.y < totalLine.y));
    const transactions: ParsedTransaction[] = [];
    const warnings: string[] = [];
    buildRecords(body, isAnchor).forEach((rec, i) => {
      const c = cells(rec.lines, COLUMNS);
      const amount = charge(c.charged!);
      if (amount.minor === 0n) {
        warnings.push(`"${c.description}" was not charged (${c.notes}); skipped`);
        return;
      }
      const notes = c.notes || undefined;
      const inst = parseInstallment(notes);
      const orig = notes?.match(/סכום העסקה.*?([$€£][\d,.]+)/)?.[1];
      transactions.push({
        rowIndex: i,
        raw: c,
        purchaseDate: parseIlDate(c.date!),
        postingDate,
        description: c.description!,
        amount,
        originalAmount: orig ? money(orig, currencyIn(orig)) : undefined,
        installment: inst,
        status: "posted",
        notes,
      });
    });

    const text = content.text;
    const last4 = lines.find((l) => lineText(l).includes("לכרטיס"))?.items.find((i) => /^\d{4}$/.test(i.s))?.s;
    return {
      adapter: this.id,
      adapterVersion: this.version,
      account: { type: "credit_card", institution: "cal", cardLast4: last4, bankAccount: text.match(/\d{3}-\d{7}/)?.[0] },
      transactions,
      totals: [
        { label: lineText(totalLine), postingDate, amount: money(totalText), rowIndices: transactions.map((t) => t.rowIndex) },
      ],
      warnings,
    };
  },
};
