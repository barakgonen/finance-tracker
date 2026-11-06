// Dev tool: parse files and print a summary (or full JSON with --json). Run after `pnpm build`.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseFile } from "../dist/index.js";

const json = process.argv.includes("--json");
const fmt = (m) => (m ? (Number(m.minor) / 100).toFixed(2) + (m.currency === "ILS" ? "" : " " + m.currency) : "");
for (const path of process.argv.slice(2).filter((a) => a !== "--json")) {
  try {
    const { statement: s, reconciliation: r } = await parseFile({ fileName: basename(path), bytes: new Uint8Array(readFileSync(path)) });
    console.log(`\n### ${path}  [${s.adapter}] ${JSON.stringify(s.account)}  txs=${s.transactions.length}  reconciled=${r.ok}`);
    for (const c of r.checks) console.log(`   check ${c.ok ? "OK " : "BAD"} ${c.label.slice(0, 60)}  expected=${c.expectedMinor} actual=${c.actualMinor}`);
    for (const w of s.warnings) console.log(`   warn ${w}`);
    if (json) console.log(JSON.stringify(s.transactions, (k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
    else for (const t of s.transactions)
      console.log(`   ${t.purchaseDate} ${t.postingDate ?? ""} ${fmt(t.amount).padStart(10)} ${t.originalAmount ? "(" + fmt(t.originalAmount) + ")" : ""} ${t.installment ? `[${t.installment.no}/${t.installment.total}]` : ""} ${t.description} | ${t.categoryHint ?? ""} | ${t.typeHint ?? ""} ${t.balance ? "bal=" + fmt(t.balance) : ""}`);
  } catch (e) {
    console.log(`\n### ${path}  ERROR ${e.stack}`);
  }
}
