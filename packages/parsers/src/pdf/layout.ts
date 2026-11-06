// Turns positioned PDF text into table rows. Israeli statements are RTL with right-aligned
// columns, so a fragment's *right edge* decides its column, and numbers are often split into
// several fragments ("39", "3,100.") that must be re-joined left-to-right.

export interface PdfItem {
  x: number;
  /** right edge (x + width) */
  r: number;
  y: number;
  s: string;
}

export interface PdfPage {
  page: number;
  items: PdfItem[];
}

export interface Line {
  page: number;
  y: number;
  items: PdfItem[];
}

const HEBREW = /[֐-׿]/;
const BIDI_MARKS = /[‎‏‪-‮]/g;

/** pdf.js returns RTL runs in visual order, which mirrors brackets: ")מקס סטוק(" -> "(מקס סטוק)". */
export function fixBidi(s: string): string {
  const clean = s.replace(BIDI_MARKS, "");
  if (!HEBREW.test(clean)) return clean;
  return clean.replace(/[()]/g, (c) => (c === "(" ? ")" : "("));
}

export async function extractPdf(bytes: Uint8Array): Promise<PdfPage[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js may detach the buffer it is given
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: true, verbosity: 0 }).promise;
  const pages: PdfPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const x = it.transform[4] as number;
      items.push({ x, r: x + it.width, y: it.transform[5] as number, s: fixBidi(it.str.trim()) });
    }
    pages.push({ page: p, items });
  }
  await doc.destroy();
  return pages;
}

/** Groups items into visual lines (top to bottom). Items within `tolerance` of a line's y join it. */
export function groupLines(pages: PdfPage[], tolerance = 2): Line[] {
  const out: Line[] = [];
  for (const { page, items } of pages) {
    const lines: Line[] = [];
    for (const it of [...items].sort((a, b) => b.y - a.y)) {
      const line = lines.find((l) => Math.abs(l.y - it.y) <= tolerance);
      if (line) line.items.push(it);
      else lines.push({ page, y: it.y, items: [it] });
    }
    for (const l of lines) l.items.sort((a, b) => b.x - a.x);
    out.push(...lines);
  }
  return out;
}

export function lineText(line: Line): string {
  return line.items.map((i) => i.s).join(" ");
}

export interface Column {
  name: string;
  /** right edge of the column (right-aligned content ends here) */
  right: number;
  kind: "text" | "number";
  /**
   * Text columns only: x at or left of which a line is considered to fill the column. A wrapped
   * line following a single word that fills the column is a mid-word break and is glued on.
   */
  fullWidthX?: number;
}

/**
 * Locates a header line containing `labels` (each matched against one fragment, in RTL order)
 * and returns their right edges, which are the column right edges.
 */
export function findHeader(line: Line, labels: string[]): number[] | null {
  const rights: number[] = [];
  let i = 0;
  for (const label of labels) {
    while (i < line.items.length && line.items[i]!.s !== label) i++;
    if (i >= line.items.length) return null;
    rights.push(line.items[i]!.r);
    i++;
  }
  return rights;
}

/** Column whose right edge is the smallest one at or beyond the item's right edge. */
export function columnFor(item: PdfItem, columns: Column[], tolerance = 3): Column | null {
  let best: Column | null = null;
  for (const c of columns) {
    if (item.r <= c.right + tolerance && (!best || c.right < best.right)) best = c;
  }
  return best;
}

/** Joins the items of a record into named cells. */
export function cells(lines: Line[], columns: Column[]): Record<string, string> {
  const buckets = new Map<Column, { line: number; item: PdfItem }[]>();
  lines.forEach((line, li) => {
    for (const item of line.items) {
      const col = columnFor(item, columns);
      if (!col) continue;
      if (!buckets.has(col)) buckets.set(col, []);
      buckets.get(col)!.push({ line: li, item });
    }
  });
  const out: Record<string, string> = {};
  for (const col of columns) {
    const parts = buckets.get(col) ?? [];
    if (col.kind === "number") {
      // numeric fragments are LTR: join left to right, no spaces
      out[col.name] = parts
        .map((p) => p.item)
        .sort((a, b) => a.x - b.x)
        .map((i) => i.s)
        .join("");
    } else {
      // words within a line run right to left; wrapped lines follow top to bottom
      const perLine = new Map<number, PdfItem[]>();
      for (const p of parts) perLine.set(p.line, [...(perLine.get(p.line) ?? []), p.item]);
      const segments = [...perLine.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, items]) => items.sort((a, b) => b.x - a.x));
      out[col.name] = segments
        .map((items, i) => {
          const text = items.map((it) => it.s).join(" ");
          const prev = segments[i - 1];
          if (!prev) return text;
          // a line ending in "-" was hyphen-wrapped; a single word filling the column was broken mid-word
          const midWord =
            prev[prev.length - 1]!.s.endsWith("-") ||
            (col.fullWidthX !== undefined && prev.length === 1 && prev[0]!.x <= col.fullWidthX);
          return midWord ? text : ` ${text}`;
        })
        .join("")
        .replace(/\s+/g, " ")
        .replace(/ ([.,])/g, "$1")
        .trim();
    }
  }
  return out;
}

/**
 * Builds records from lines: every anchor line starts a record, and each other line is
 * attached to the nearest anchor on the same page within `maxGap` (wrapped descriptions can
 * sit slightly above or below the anchor's baseline).
 */
export interface PdfRecord {
  anchor: Line;
  /** all lines of the record, anchor included, top to bottom */
  lines: Line[];
}

export function buildRecords(lines: Line[], isAnchor: (l: Line) => boolean, maxGap = 16): PdfRecord[] {
  const anchors = lines.filter(isAnchor);
  const records = new Map<Line, Line[]>(anchors.map((a) => [a, [a]]));
  for (const line of lines) {
    if (records.has(line)) continue;
    let best: Line | null = null;
    for (const a of anchors) {
      if (a.page !== line.page) continue;
      const d = Math.abs(a.y - line.y);
      if (d <= maxGap && (!best || d < Math.abs(best.y - line.y))) best = a;
    }
    if (best) records.get(best)!.push(line);
  }
  return anchors.map((a) => ({ anchor: a, lines: records.get(a)!.sort((l1, l2) => l2.y - l1.y) }));
}

const PRINT_CHROME = [/^about:blank$/, /^https?:\/\//, /^\d{1,2}\/\d{1,2}\/\d{2}, \d{1,2}:\d{2} [AP]M$/, /^\d+\/\d+$/];

/** Removes the header/footer a browser adds when printing a web page to PDF (URL, timestamp, page x/y). */
export function stripPrintChrome(lines: Line[]): Line[] {
  return lines
    .map((l) => ({ ...l, items: l.items.filter((i) => !PRINT_CHROME.some((re) => re.test(i.s))) }))
    .filter((l) => l.items.length > 0);
}
