// Checks that the numbers in an answer appear in the data the tools returned. Not a proof (a
// coincidental match passes), but it catches invented or miscalculated figures, which the UI
// then shows next to the answer.

/** Every number found anywhere in the tool results, plus percent forms of fractions. */
export function numbersIn(toolResults: string[]): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      out.push(Math.abs(v));
      if (Math.abs(v) <= 1) out.push(Math.abs(v) * 100); // shares and rates appear as percents
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const r of toolResults) {
    try {
      walk(JSON.parse(r));
    } catch {
      // error results are plain text
    }
  }
  return out;
}

/** Numbers stated in the answer that are worth checking: amounts and percentages, not dates or small counts. */
export function numbersStated(text: string): { raw: string; value: number }[] {
  const cleaned = text
    .replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, " ") // dates
    .replace(/\b\d{4}-\d{2}(-\d{2})?\b/g, " ") // ISO months/dates
    .replace(/\b(19|20)\d{2}\b(?!,\d{3})/g, " "); // years
  const out: { raw: string; value: number }[] = [];
  for (const m of cleaned.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const value = Number(m[0].replace(/,/g, ""));
    if (value >= 10) out.push({ raw: m[0], value }); // small counts ("3 months") aren't worth flagging
  }
  return out;
}

export interface Verification {
  checked: number;
  /** numbers in the answer not found in any tool result (allowing for rounding) */
  untraced: string[];
}

export function verifyAnswer(answer: string, toolResults: string[]): Verification {
  const known = numbersIn(toolResults);
  const stated = numbersStated(answer);
  const traced = (n: number) => known.some((k) => Math.abs(n - k) <= Math.max(0.51, k * 0.005));
  return { checked: stated.length, untraced: [...new Set(stated.filter((s) => !traced(s.value)).map((s) => s.raw))] };
}

/** Splits an answer into paragraphs with their statement kind (from the label the model was asked to use). */
export function labelParagraphs(answer: string, labels: Record<string, string>): { kind: string | null; text: string }[] {
  return answer
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^\**([^:*\n]{2,20})\**\s*:\**\s*/);
      const kind = m ? (labels[m[1]!.trim()] ?? null) : null;
      return { kind, text: kind ? p.slice(m![0].length) : p };
    });
}
