// Hebrew wording for the services' error messages (which are English, for logs and tests).
import { requestLocale } from "./locale";
const EXACT: Record<string, string> = {
  "A committed import can't be discarded": "אי אפשר לבטל ייבוא שכבר הושלם.",
  "Can't merge a merchant into itself": "אי אפשר לאחד בית עסק עם עצמו.",
  "Card number must be exactly 4 digits": "יש להזין בדיוק 4 ספרות אחרונות של הכרטיס.",
  "Choose a spending category": "יש לבחור קטגוריית הוצאה.",
  "This charge no longer matches that card bill": "החיוב הזה כבר לא תואם לדוח הכרטיס. ייתכן שכבר טופל.",
  "Enter a target amount": "יש להזין סכום יעד.",
  "A split needs at least two parts": "בפיצול צריכים להיות לפחות שני חלקים.",
  "Every part needs a positive amount": "לכל חלק צריך סכום חיובי.",
  "The parts must add up to the transaction amount": "החלקים צריכים להסתכם בדיוק בסכום התנועה.",
  "Choose categories that fit the transaction": "יש לבחור קטגוריות שמתאימות לתנועה (הוצאה או הכנסה).",
  "Only spending or income can be split": "אפשר לפצל רק הוצאות או הכנסות.",
  "A category with this name already exists": "כבר קיימת קטגוריה בשם הזה.",
  "The name is too long (40 characters at most)": "השם ארוך מדי (עד 40 תווים).",
  "Built-in categories can't be changed": "אי אפשר לשנות קטגוריות מובנות.",
  "Choose another category of the same type": "יש לבחור קטגוריה אחרת מאותו סוג.",
  "Category not found": "הקטגוריה לא נמצאה.",
  "Read-only members can't make changes": "חשבון צפייה בלבד לא יכול לבצע שינויים.",
  "Only money coming in can be income": "רק כסף שנכנס לחשבון יכול להיות הכנסה.",
  email_taken: "האימייל הזה כבר רשום.",
  "Give the goal a name": "יש לתת שם ליעד.",
  "Invalid start month": "חודש ההתחלה לא תקין.",
  "Name is required": "יש להזין שם.",
  "The alert threshold must be between 1% and 100%": "סף ההתראה צריך להיות בין 1% ל-100%.",
  "The bill description pattern is not valid": "הדפוס של תיאור החיוב לא תקין.",
  "The deadline must be after the start month": "תאריך היעד צריך להיות אחרי חודש ההתחלה.",
  "The limit must be positive": "הסכום צריך להיות גדול מאפס.",
  "The rate must be between 1% and 99%": "השיעור צריך להיות בין 1% ל-99%.",
  "The reduction must be between 1% and 99%": "אחוז ההפחתה צריך להיות בין 1% ל-99%.",
  "The target must be positive": "סכום היעד צריך להיות גדול מאפס.",
  "There's no recent spending in this category to reduce": "אין הוצאה ב-3 החודשים האחרונים בקטגוריה הזו, אז אין ממה להפחית.",
  "This invite link is invalid, used or expired": "קישור ההזמנה לא תקין, כבר נוצל או שפג תוקפו.",
  "This member already has a login": "לחבר/ה הזה/ו כבר יש משתמש.",
  "Choose which account this statement belongs to": "יש לבחור לאיזה חשבון שייך הדוח.",
  "The statement's totals don't match its transactions": "הסכומים בדוח לא תואמים לתנועות.",
  "Account not found": "החשבון לא נמצא.",
  "Budget not found": "התקציב לא נמצא.",
  "Goal not found": "היעד לא נמצא.",
  "Import not found": "הייבוא לא נמצא.",
  "Invitation not found": "ההזמנה לא נמצאה.",
  "Member not found": "חבר/ת משק הבית לא נמצא/ה.",
  "Merchant not found": "בית העסק לא נמצא.",
  "Transaction not found": "התנועה לא נמצאה.",
  missing: "יש למלא את כל השדות כנדרש.",
  "Invalid insight": "התובנה לא נמצאה.",
};

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Unknown category (.+)$/, () => "הקטגוריה לא נמצאה."],
  [/^Import is (\w+), not ready to commit$/, () => "הייבוא הזה כבר טופל."],
  [/^This file was already imported \((.+)\)$/, (m) => `הקובץ הזה כבר יובא (${m[1]}).`],
  [/^A (\w+) statement can't go into a (\w+) account$/, () => "סוג הדוח לא מתאים לחשבון שנבחר (בנק מול כרטיס)."],
];

const HEBREW = /[֐-׿]/;

// the few error codes that aren't already an English sentence
const ENGLISH_CODES: Record<string, string> = {
  missing: "Please fill in all fields as required.",
  email_taken: "This email is already registered.",
};

/**
 * The message for a service error in the request's language: Hebrew from the maps below; in
 * English the service's own message (they are English sentences). Unknown errors get a generic text.
 */
export function hebrewError(message: string | null | undefined): string {
  if (requestLocale() === "en") {
    if (!message) return "Something went wrong. Try again.";
    if (ENGLISH_CODES[message]) return ENGLISH_CODES[message]!;
    const known = message in EXACT || PATTERNS.some(([re]) => re.test(message));
    return known ? message : "Something went wrong. Try again.";
  }
  if (!message) return "משהו השתבש. נסו שוב.";
  if (EXACT[message]) return EXACT[message]!;
  for (const [re, fn] of PATTERNS) {
    const m = message.match(re);
    if (m) return fn(m);
  }
  return HEBREW.test(message) ? message : "משהו השתבש. נסו שוב.";
}
