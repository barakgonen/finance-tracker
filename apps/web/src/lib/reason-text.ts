// Hebrew wording for the reasons stored on transactions (English in the database, for logs and tests).
import { date, money } from "./format";

const agorot = (decimal: string) => BigInt(Math.round(Number(decimal) * 100));

const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^low confidence$/, () => "סיווג לא ודאי"],
  [/^card bill: which card\? \((.*)\)$/, (cards) => `חיוב כרטיס: של איזה כרטיס? (${cards})`],
  [/^card bill from an unknown card$/, () => "חיוב של כרטיס שלא מוכר במערכת"],
  [/^statement for (.+) not imported yet$/, (card) => `הדוח של ${card} עוד לא יובא`],
  [
    /^bank charge ([\d.]+) differs from the (.+) statement total ([\d.]+)$/,
    (bank, card, total) => `החיוב בבנק (${money(agorot(bank))}) שונה מסכום הדוח של ${card} (${money(agorot(total))}). לא נספר כהוצאה כדי לא לספור פעמיים.`,
  ],
  [/^pays (.+) bill of (\d{4}-\d{2}-\d{2})$/, (card, d) => `תשלום הדוח של ${card} מ-${date(d)}`],
  [/^pays (\d+) card bills$/, (n) => `תשלום ${n} דוחות כרטיס`],
  [/^nearly equals the (.+) bill of (\d{4}-\d{2}-\d{2})$/, (card, d) => `כמעט שווה לדוח של ${card} מ-${date(d)}`],
  [/^rule /, () => "לפי כלל"],
  [/^merchant "(.*)"$/, (m) => `לפי בית העסק "${m}"`],
  [/^similar to "(.*)"$/, (m) => `דומה ל-"${m}"`],
  [/^issuer type (.*)$/, (t) => `לפי סוג העסקה: ${t}`],
  [/^unrecognized$/, () => "לא זוהה"],
  [/^card bill difference$/, () => "הפרש בין החיוב בבנק לדוח הכרטיס"],
  [/^manual$/, () => "תוקן ידנית"],
];

export function hebrewReason(reason: string): string {
  for (const [re, text] of PATTERNS) {
    const m = re.exec(reason);
    if (m) return text(...m.slice(1));
  }
  return reason;
}
