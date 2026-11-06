import type { Money } from "@ft/core";

export interface InputFile {
  fileName: string;
  bytes: Uint8Array;
}

export type FileFormat = "pdf" | "xlsx" | "html";

export interface AccountHint {
  type: "bank" | "credit_card";
  institution: string;
  /** Card last 4 digits, when the statement names a single card. */
  cardLast4?: string;
  /** Bank account the card settles to / the bank account itself, as printed. */
  bankAccount?: string;
}

export interface ParsedTransaction {
  /** Index of the source row in the file; links to raw_row. */
  rowIndex: number;
  /** Source cells exactly as extracted, preserved as raw_row payload. */
  raw: Record<string, string>;
  purchaseDate: string; // YYYY-MM-DD
  postingDate?: string;
  description: string;
  /** Signed amount in account currency: negative = money out. */
  amount: Money;
  originalAmount?: Money;
  /** Institution's own category label (e.g. ענף), used as a classification hint. */
  categoryHint?: string;
  /** Institution's transaction-type label (e.g. "רגילה", "תשלומים", "זיכוי", "הוראת קבע"). */
  typeHint?: string;
  installment?: { no: number; total: number; originalAmount?: Money };
  cardLast4?: string;
  status: "pending" | "posted";
  /** Running balance after this row (bank exports). */
  balance?: Money;
  reference?: string;
  notes?: string;
}

/** A total printed on the statement that a subset of transactions must add up to. */
export interface StatementTotal {
  label: string;
  postingDate?: string;
  /** Printed total of money out (positive number). */
  amount: Money;
  /** Which transactions this total covers. */
  rowIndices: number[];
}

export interface ParsedStatement {
  adapter: string;
  adapterVersion: number;
  account: AccountHint;
  transactions: ParsedTransaction[];
  totals: StatementTotal[];
  /** Closing balance as printed (bank exports). */
  closingBalance?: { asOf: string; balance: Money };
  warnings: string[];
}

export interface SourceAdapter {
  id: string;
  version: number;
  format: FileFormat;
  /** Cheap check on already-extracted content. */
  detect(content: ExtractedContent): boolean;
  parse(content: ExtractedContent, file: InputFile): ParsedStatement;
}

export type ExtractedContent =
  | { format: "pdf"; pages: import("./pdf/layout.js").PdfPage[]; text: string }
  | { format: "xlsx"; sheets: import("./xlsx/reader.js").Sheet[] }
  | { format: "html"; html: string };
