import type { ParsedStatement } from "./types.js";

export interface ReconciliationCheck {
  label: string;
  expectedMinor: bigint;
  actualMinor: bigint;
  ok: boolean;
}

export interface ReconciliationResult {
  ok: boolean;
  checks: ReconciliationCheck[];
  /** Human-readable reasons when ok=false; the import then needs an explicit override. */
  problems: string[];
}

/**
 * Verifies a parsed statement against numbers printed on it:
 * - card statements: transactions covered by each printed total must sum to it;
 * - bank exports: the running balance must be consistent row to row, and the latest
 *   balance must match the printed closing balance.
 */
export function reconcile(stmt: ParsedStatement): ReconciliationResult {
  const checks: ReconciliationCheck[] = [];
  const problems: string[] = [];
  const byRow = new Map(stmt.transactions.map((t) => [t.rowIndex, t]));

  for (const total of stmt.totals) {
    const actual = total.rowIndices.reduce((acc, i) => acc - (byRow.get(i)?.amount.minor ?? 0n), 0n);
    checks.push({ label: total.label, expectedMinor: total.amount.minor, actualMinor: actual, ok: actual === total.amount.minor });
  }

  const withBalance = stmt.transactions.filter((t) => t.balance);
  if (withBalance.length >= 1) {
    const chainOk = (rows: typeof withBalance) =>
      rows.every((t, i) => i === 0 || rows[i - 1]!.balance!.minor + t.amount.minor === t.balance!.minor);
    // exports list rows newest-first or oldest-first; accept either, but it must be consistent
    const ordered = chainOk(withBalance) ? withBalance : chainOk([...withBalance].reverse()) ? [...withBalance].reverse() : null;
    // a single row has no chain to check; the closing balance below still applies
    if (withBalance.length >= 2) {
      checks.push({ label: "running balance", expectedMinor: 0n, actualMinor: ordered ? 0n : 1n, ok: ordered !== null });
    }
    if (ordered && stmt.closingBalance) {
      const last = ordered[ordered.length - 1]!.balance!.minor;
      checks.push({
        label: `closing balance ${stmt.closingBalance.asOf}`,
        expectedMinor: stmt.closingBalance.balance.minor,
        actualMinor: last,
        ok: last === stmt.closingBalance.balance.minor,
      });
    }
  }

  if (checks.length === 0) problems.push("Statement has no printed totals or balances to reconcile against");
  for (const c of checks.filter((c) => !c.ok)) {
    problems.push(`${c.label}: expected ${c.expectedMinor}, got ${c.actualMinor}`);
  }
  return { ok: problems.length === 0, checks, problems };
}
