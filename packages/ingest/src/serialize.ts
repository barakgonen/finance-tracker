import type { ParsedStatement } from "@ft/parsers";

/** ParsedStatement holds bigints (Money.minor); JSON columns store them as strings. */
export function statementToJson(s: ParsedStatement): unknown {
  return JSON.parse(JSON.stringify(s, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export function statementFromJson(json: unknown): ParsedStatement {
  return JSON.parse(JSON.stringify(json), (key, v) => (key === "minor" && typeof v === "string" ? BigInt(v) : v));
}
