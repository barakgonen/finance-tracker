// Dev tool: print PDF text grouped into visual lines (y), items sorted right-to-left (x desc).
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";

const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), useSystemFonts: true }).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const { items } = await page.getTextContent();
  const lines = new Map();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    if (!lines.has(y)) lines.set(y, []);
    lines.get(y).push({ x: Math.round(it.transform[4]), r: Math.round(it.transform[4] + it.width), s: it.str });
  }
  console.log(`===== page ${p}`);
  for (const y of [...lines.keys()].sort((a, b) => b - a)) {
    const cells = lines.get(y).sort((a, b) => b.x - a.x).map((c) => process.env.RIGHT ? `${c.x}-${c.r}:${c.s}` : `${c.x}:${c.s}`);
    console.log(y, cells.join(" | "));
  }
}
