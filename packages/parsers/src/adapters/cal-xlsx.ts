import type { ParsedTransaction, SourceAdapter } from "../types.js";
import { excelSerialToIso, type CellValue } from "../xlsx/reader.js";
import { charge, money } from "../amounts.js";
import { parseIlDate, parseInstallment } from "../dates.js";

const TITLE = /פירוט עסקאות לחשבון (.+?) (\d[\d-]+) לכרטיס .*?המסתיים ב-(\d{4})/;
const TOTAL = /עסקאות לחיוב ב-(\d{2}\/\d{2}\/\d{4}):\s*([\d,.-]+)/;

const str = (v: CellValue | undefined) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

export const calXlsx: SourceAdapter = {
  id: "cal-xlsx",
  version: 1,
  format: "xlsx",
  detect: (c) => c.format === "xlsx" && TITLE.test(str(c.sheets[0]?.rows[0]?.[0])),
  parse(content) {
    if (content.format !== "xlsx") throw new Error("expected xlsx");
    const sheet = content.sheets[0]!;
    const title = str(sheet.rows[0]?.[0]).match(TITLE)!;
    const totalLine = sheet.rows.map((r) => str(r[0])).find((s) => TOTAL.test(s));
    const totalMatch = totalLine?.match(TOTAL);
    const postingDate = totalMatch ? parseIlDate(totalMatch[1]!) : undefined;

    const headerAt = sheet.rows.findIndex((r) => str(r[0]) === "תאריך עסקה");
    if (headerAt < 0) throw new Error("Cal export: header row not found");
    const header = sheet.rows[headerAt]!.map(str);
    const col = (name: string) => header.indexOf(name);

    const transactions: ParsedTransaction[] = [];
    const warnings: string[] = [];
    for (let i = headerAt + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i]!;
      const dateCell = row[col("תאריך עסקה")];
      if (typeof dateCell !== "number") continue; // footer / disclaimer rows
      const raw = Object.fromEntries(header.map((h, j) => [h, str(row[j])]).filter(([h]) => h));
      const charged = row[col("סכום חיוב")];
      const amountTx = row[col("סכום עסקה")];
      if (charged == null || charged === "") {
        // e.g. club cashback accrual lines: shown on the statement but never charged
        warnings.push(`Row ${i + 1} "${raw["שם בית עסק"]}" has no charged amount; skipped`);
        continue;
      }
      const notes = raw["הערות"] || undefined;
      const inst = parseInstallment(notes);
      transactions.push({
        rowIndex: i,
        raw,
        purchaseDate: excelSerialToIso(dateCell),
        postingDate,
        description: raw["שם בית עסק"]!,
        amount: charge(Number(charged)),
        categoryHint: raw["ענף"] || undefined,
        typeHint: raw["סוג עסקה"] || undefined,
        installment: inst && { ...inst, originalAmount: typeof amountTx === "number" ? money(amountTx) : undefined },
        cardLast4: title[3],
        status: "posted",
        notes,
      });
    }

    return {
      adapter: this.id,
      adapterVersion: this.version,
      account: { type: "credit_card", institution: "cal", cardLast4: title[3], bankAccount: title[2] },
      transactions,
      totals: totalMatch
        ? [
            {
              label: totalLine!,
              postingDate,
              amount: money(totalMatch[2]!),
              rowIndices: transactions.map((t) => t.rowIndex),
            },
          ]
        : [],
      warnings,
    };
  },
};
