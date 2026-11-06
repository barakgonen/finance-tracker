// Dev tool: classify every transaction in the given files and report coverage. Run after `pnpm build`.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { classify } from "@ft/core";
import { parseFile } from "../dist/index.js";

const verbose = process.argv.includes("-v");
const stats = new Map();
const review = [];
for (const path of process.argv.slice(2).filter((a) => a !== "-v")) {
  const { statement: s } = await parseFile({ fileName: basename(path), bytes: new Uint8Array(readFileSync(path)) });
  for (const t of s.transactions) {
    const c = classify({ description: t.description, amountMinor: t.amount.minor, accountType: s.account.type, categoryHint: t.categoryHint, typeHint: t.typeHint });
    const st = stats.get(s.adapter) ?? { total: 0, auto: 0 };
    st.total++;
    if (!c.needsReview) st.auto++;
    stats.set(s.adapter, st);
    const line = `${(Number(t.amount.minor) / 100).toFixed(2).padStart(10)}  ${c.kind.padEnd(18)} ${String(c.category).padEnd(16)} ${c.confidence.toFixed(2)} ${c.needsReview ? "REVIEW" : "      "} ${t.description} | ${t.categoryHint ?? ""} | ${c.reason}`;
    if (c.needsReview) review.push(`[${s.adapter}] ${line}`);
    else if (verbose) console.log(`[${s.adapter}] ${line}`);
  }
}
for (const [a, { total, auto }] of stats) console.log(`${a.padEnd(14)} ${auto}/${total} auto (${((100 * auto) / total).toFixed(0)}%)`);
const all = [...stats.values()].reduce((a, s) => ({ total: a.total + s.total, auto: a.auto + s.auto }), { total: 0, auto: 0 });
console.log(`TOTAL          ${all.auto}/${all.total} auto (${((100 * all.auto) / all.total).toFixed(0)}%)\n\nNEEDS REVIEW:`);
for (const r of [...new Set(review)]) console.log(r);
