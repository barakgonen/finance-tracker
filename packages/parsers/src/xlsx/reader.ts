// Minimal XLSX reader. Institutions emit OOXML that some libraries reject (e.g. Cal uses
// "x:"-prefixed elements), so we read the zip and XML directly with namespace prefixes removed.
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export type CellValue = string | number | null;

export interface Sheet {
  name: string;
  rows: CellValue[][];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  // keep text verbatim: numbers are parsed by us, not by the XML layer
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ["sheet", "row", "c", "si", "r", "Relationship"].includes(name),
});

export function readXlsx(bytes: Uint8Array): Sheet[] {
  const files = unzipSync(bytes);
  const get = (path: string) => {
    const key = Object.keys(files).find((k) => k.toLowerCase() === path.toLowerCase());
    return key ? strFromU8(files[key]!) : undefined;
  };

  const shared = parseSharedStrings(get("xl/sharedStrings.xml"));
  const workbook = parser.parse(get("xl/workbook.xml") ?? "");
  const rels = parser.parse(get("xl/_rels/workbook.xml.rels") ?? "");
  const relTargets = new Map<string, string>(
    (rels.Relationships?.Relationship ?? []).map((r: Record<string, string>) => [r["@Id"], r["@Target"]]),
  );

  const sheets: Sheet[] = [];
  for (const s of workbook.workbook?.sheets?.sheet ?? []) {
    const target = relTargets.get(s["@id"]) ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = get(path);
    if (!xml) continue;
    sheets.push({ name: s["@name"], rows: parseSheet(xml, shared) });
  }
  return sheets;
}

function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in (node as object)) return String((node as { "#text": unknown })["#text"]);
  return "";
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const doc = parser.parse(xml);
  return (doc.sst?.si ?? []).map((si: { t?: unknown; r?: { t?: unknown }[] }) =>
    si.r ? si.r.map((r) => textOf(r.t)).join("") : textOf(si.t),
  );
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): CellValue[][] {
  const doc = parser.parse(xml);
  const rows: CellValue[][] = [];
  for (const row of doc.worksheet?.sheetData?.row ?? []) {
    const r = Number(row["@r"]) - 1;
    const cells: CellValue[] = [];
    for (const c of row.c ?? []) {
      const idx = columnIndex(c["@r"]);
      const raw = textOf(c.v);
      let value: CellValue = null;
      if (c["@t"] === "s") value = raw === "" ? null : (shared[Number(raw)] ?? null);
      else if (c["@t"] === "inlineStr") value = textOf(c.is?.t);
      else if (c["@t"] === "str" || c["@t"] === "b") value = raw;
      else if (raw !== "") value = Number(raw);
      cells[idx] = value;
    }
    rows[r] = Array.from(cells, (v) => (v === undefined ? null : v));
  }
  return Array.from(rows, (r) => r ?? []);
}

/** Excel serial date (1900 system) -> YYYY-MM-DD. */
export function excelSerialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}
