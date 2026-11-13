import type { ExtractedContent, InputFile, ParsedStatement, SourceAdapter } from "./types.js";
import { extractPdf, groupLines, lineText } from "./pdf/layout.js";
import { readXlsx } from "./xlsx/reader.js";
import { reconcile, type ReconciliationResult } from "./reconcile.js";
import { isracardPdf } from "./adapters/isracard-pdf.js";
import { calPdf } from "./adapters/cal-pdf.js";
import { calXlsx } from "./adapters/cal-xlsx.js";
import { maxPdf } from "./adapters/max-pdf.js";
import { maxXlsx } from "./adapters/max-xlsx.js";
import { leumiPdf } from "./adapters/leumi-pdf.js";
import { leumiHtml } from "./adapters/leumi-html.js";

export * from "./types.js";
export { reconcile, type ReconciliationResult } from "./reconcile.js";

export const ADAPTERS: SourceAdapter[] = [isracardPdf, calPdf, calXlsx, maxPdf, maxXlsx, leumiPdf, leumiHtml];

/** The installed version of a parser, or null if no such parser exists any more. */
export function currentParserVersion(adapterId: string): number | null {
  return ADAPTERS.find((a) => a.id === adapterId)?.version ?? null;
}

export async function extract(file: InputFile): Promise<ExtractedContent> {
  const b = file.bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    const pages = await extractPdf(b);
    return { format: "pdf", pages, text: groupLines(pages).map(lineText).join("\n") };
  }
  if (b[0] === 0x50 && b[1] === 0x4b) return { format: "xlsx", sheets: readXlsx(b) };
  const text = new TextDecoder("utf-8").decode(b);
  if (/<html|<table/i.test(text)) return { format: "html", html: text };
  throw new Error(`Unsupported file format: ${file.fileName}`);
}

export interface ParseResult {
  statement: ParsedStatement;
  reconciliation: ReconciliationResult;
}

export async function parseFile(file: InputFile): Promise<ParseResult> {
  const content = await extract(file);
  const matches = ADAPTERS.filter((a) => a.format === content.format && a.detect(content));
  if (matches.length === 0) throw new Error(`No parser recognizes ${file.fileName}`);
  if (matches.length > 1) throw new Error(`Ambiguous parsers for ${file.fileName}: ${matches.map((m) => m.id).join(", ")}`);
  const statement = matches[0]!.parse(content, file);
  return { statement, reconciliation: reconcile(statement) };
}
export { readXlsx, excelSerialToIso, type Sheet } from "./xlsx/reader.js";
