// Hebrew wording for the services' error messages (which are English, for logs and tests).
const EXACT: Record<string, string> = {
  "A committed import can't be discarded": "אי אפשר לבטל ייבוא שכבר הושלם.",
  "Can't merge a merchant into itself": "אי אפשר לאחד בית עסק עם עצמו.",
  "Card number must be exactly 4 digits": "יש להזין בדיוק 4 ספרות אחרונות של הכרטיס.",
  "Choose a spending category": "יש לבחור קטגוריית הוצאה.",
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
};

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Unknown category (.+)$/, () => "הקטגוריה לא נמצאה."],
  [/^Import is (\w+), not ready to commit$/, () => "הייבוא הזה כבר טופל."],
  [/^This file was already imported \((.+)\)$/, (m) => `הקובץ הזה כבר יובא (${m[1]}).`],
  [/^A (\w+) statement can't go into a (\w+) account$/, () => "סוג הדוח לא מתאים לחשבון שנבחר (בנק מול כרטיס)."],
];

const HEBREW = /[֐-׿]/;

/** The Hebrew message for a service error (Hebrew messages pass through; unknown ones get a generic text). */
export function hebrewError(message: string | null | undefined): string {
  if (!message) return "משהו השתבש. נסו שוב.";
  if (EXACT[message]) return EXACT[message]!;
  for (const [re, fn] of PATTERNS) {
    const m = message.match(re);
    if (m) return fn(m);
  }
  return HEBREW.test(message) ? message : "משהו השתבש. נסו שוב.";
}
