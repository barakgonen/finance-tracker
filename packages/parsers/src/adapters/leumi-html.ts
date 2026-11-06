import { parse as parseHtml } from "node-html-parser";
import type { ParsedTransaction, SourceAdapter } from "../types.js";
import { money } from "../amounts.js";
import { IL_DATE, parseIlDate } from "../dates.js";

const clean = (s: string) => s.replace(/[‎‏]/g, "").replace(/\s+/g, " ").trim();

/** Leumi's "Excel" export is an HTML table saved with an .xls extension. */
export const leumiHtml: SourceAdapter = {
  id: "leumi-html",
  version: 1,
  format: "html",
  detect: (c) => c.format === "html" && c.html.includes("בנק לאומי") && c.html.includes("תנועות בחשבון"),
  parse(content) {
    if (content.format !== "html") throw new Error("expected html");
    const root = parseHtml(content.html);
    const rows = root.querySelectorAll("tr").map((tr) => tr.querySelectorAll("td,th").map((c) => clean(c.text)));
    const flat = rows.map((r) => r.join(" "));

    const account = flat.join(" ").match(/מס' חשבון\s*:\s*([\d/-]+)/)?.[1];
    const header = rows.find((r) => r[0] === "תאריך" && r.includes("בחובה"));
    if (!header) throw new Error("Leumi export: header row not found");
    const col = (name: string) => header.indexOf(name);

    const transactions: ParsedTransaction[] = [];
    rows.forEach((r, i) => {
      if (!IL_DATE.test(r[0] ?? "")) return;
      const debit = money(r[col("בחובה")] || "0");
      const credit = money(r[col("בזכות")] || "0");
      const balanceText = r[col('היתרה בש"ח')];
      transactions.push({
        rowIndex: i,
        raw: Object.fromEntries(header.map((h, j) => [h, r[j] ?? ""])),
        purchaseDate: parseIlDate(r[0]!),
        postingDate: r[col("תאריך ערך")] ? parseIlDate(r[col("תאריך ערך")]!) : undefined,
        description: r[col("תיאור")] ?? "",
        amount: { minor: credit.minor - debit.minor, currency: "ILS" },
        balance: balanceText ? money(balanceText) : undefined,
        reference: r[col("אסמכתא")] || undefined,
        notes: r[col("הערה")] || undefined,
        status: "posted",
      });
    });

    const balanceRow = rows.find((r) => r.some((c) => c.startsWith("היתרה")) && r.some((c) => c.startsWith("נכון לתאריך")));
    const balanceText = balanceRow?.find((c) => c.startsWith("היתרה"))?.match(/-?[\d,]+\.\d{2}/)?.[0];
    const asOfText = balanceRow?.find((c) => c.startsWith("נכון לתאריך"))?.match(/[\d.]+$/)?.[0];

    return {
      adapter: this.id,
      adapterVersion: this.version,
      account: { type: "bank", institution: "leumi", bankAccount: account },
      transactions,
      totals: [],
      closingBalance:
        balanceText && asOfText ? { asOf: parseIlDate(asOfText), balance: money(balanceText) } : undefined,
      warnings: [],
    };
  },
};
