// Dev tool: print every row of every sheet. Run after `pnpm build`.
import { readFileSync } from "node:fs";
import { readXlsx } from "../dist/xlsx/reader.js";

for (const sheet of readXlsx(new Uint8Array(readFileSync(process.argv[2])))) {
  console.log(`== sheet ${sheet.name} rows=${sheet.rows.length}`);
  sheet.rows.forEach((r, i) => r.length && console.log(i, JSON.stringify(r)));
}
