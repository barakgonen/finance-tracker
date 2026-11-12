// Wording for the reasons stored on transactions (English in the database, for logs and tests):
// Hebrew, or for an English interface the stored text with amounts and dates formatted.
import { date, money } from "./format";
import { L } from "./locale";

const agorot = (decimal: string) => BigInt(Math.round(Number(decimal) * 100));

const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^low confidence$/, () => L("סיווג לא ודאי", "Uncertain classification")],
  [/^card bill: which card\? \((.*)\)$/, (cards) => L(`חיוב כרטיס: של איזה כרטיס? (${cards})`, `Card bill: which card? (${cards})`)],
  [/^card bill from an unknown card$/, () => L("חיוב של כרטיס שלא מוכר במערכת", "Bill of a card that isn't set up")],
  [/^statement for (.+) not imported yet$/, (card) => L(`הדוח של ${card} עוד לא יובא`, `The ${card} statement isn't imported yet`)],
  [
    /^bank charge ([\d.]+) differs from the (.+) statement total ([\d.]+)$/,
    (bank, card, total) =>
      L(
        `החיוב בבנק (${money(agorot(bank))}) שונה מסכום הדוח של ${card} (${money(agorot(total))}). לא נספר כהוצאה כדי לא לספור פעמיים.`,
        `The bank charge (${money(agorot(bank))}) differs from the ${card} statement total (${money(agorot(total))}). Not counted as spending, so nothing is counted twice.`,
      ),
  ],
  [/^pays (.+) bill of (\d{4}-\d{2}-\d{2})$/, (card, d) => L(`תשלום הדוח של ${card} מ-${date(d)}`, `Pays the ${card} bill of ${date(d)}`)],
  [/^pays (\d+) card bills$/, (n) => L(`תשלום ${n} דוחות כרטיס`, `Pays ${n} card bills`)],
  [/^nearly equals the (.+) bill of (\d{4}-\d{2}-\d{2})$/, (card, d) => L(`כמעט שווה לדוח של ${card} מ-${date(d)}`, `Nearly equals the ${card} bill of ${date(d)}`)],
  [/^rule /, () => L("לפי כלל", "By a rule")],
  [/^merchant "(.*)"$/, (m) => L(`לפי בית העסק "${m}"`, `By the merchant "${m}"`)],
  [/^similar to "(.*)"$/, (m) => L(`דומה ל-"${m}"`, `Similar to "${m}"`)],
  [/^issuer type (.*)$/, (t) => L(`לפי סוג העסקה: ${t}`, `By the transaction type: ${t}`)],
  [/^unrecognized$/, () => L("לא זוהה", "Not recognized")],
  [/^card bill difference$/, () => L("הפרש בין החיוב בבנק לדוח הכרטיס", "Difference between the bank charge and the card statement")],
  [/^manual$/, () => L("תוקן ידנית", "Corrected by hand")],
];

export function hebrewReason(reason: string): string {
  for (const [re, text] of PATTERNS) {
    const m = re.exec(reason);
    if (m) return text(...m.slice(1));
  }
  return reason;
}
