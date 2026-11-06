// Built-in knowledge of Israeli banks, card issuers and merchants. Generic only: nothing
// household-specific belongs here (that is what user rules and corrections are for).
import type { TransactionKind } from "./kinds.js";

/**
 * Whole-word match for Hebrew and Latin. JS `\b` only knows ASCII word characters, so
 * `\bביט\b` never matches; Unicode lookarounds do.
 */
export function words(alternatives: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");
}

export interface DictionaryEntry {
  pattern: RegExp;
  kind?: TransactionKind;
  category?: string;
  /** Restrict to money in / out. */
  direction?: "in" | "out";
  /** Restrict to bank or card accounts. */
  account?: "bank" | "credit_card";
  confidence: number;
  label: string;
}

/** Bank statement descriptions: these mostly decide the *kind* of movement. */
export const BANK_ENTRIES: DictionaryEntry[] = [
  // card bills: confirmed (confidence 1) only when the settlement matcher finds the bill
  { pattern: /ישראכרט|כרטיסי אשראי|מקס איט|לאומי קארד|ויזה כאל|אמריקן אקספרס|דיינרס/, direction: "out", kind: "card_settlement", confidence: 0.6, label: "card issuer debit" },
  { pattern: /ישראכרט|כרטיסי אשראי|מקס איט|ל\.מאסטרקארד|לאומי קארד/, direction: "in", kind: "refund", category: "refunds", confidence: 0.6, label: "card issuer credit" },
  // fees before securities: "דמי ניהול ני\"ע" is a fee, not a trade
  { pattern: /דמי ניהול|עמלת|עמלה/, direction: "out", kind: "fee", category: "bank_fees", confidence: 0.85, label: "bank fee" },
  { pattern: /^פיקדון|^פקדון|הפקדה לפקדון|חיסכון/, direction: "out", kind: "savings_investment", confidence: 0.9, label: "deposit" },
  { pattern: /פרעון פקדון|פירעון פיקדון|שבירת פקדון/, direction: "in", kind: "savings_investment", confidence: 0.9, label: "deposit maturity" },
  { pattern: /קנית ני"ע|קניית ני"ע|מכירת ני"ע|ני"ע/, kind: "savings_investment", confidence: 0.85, label: "securities trade" },
  { pattern: /משכנת|משכנתא|פרעון הלוואה|פירעון הלוואה|החזר הלוואה/, direction: "out", kind: "loan_payment", confidence: 0.9, label: "loan repayment" },
  { pattern: words("ביט|bit|פייבוקס|paybox"), kind: "p2p_transfer", confidence: 0.8, label: "P2P wallet" },
  { pattern: /משכורת|שכר עבודה|מש"כ/, direction: "in", kind: "income", category: "salary", confidence: 0.95, label: "salary" },
  { pattern: /החזר מס|מס הכנסה החזר/, direction: "in", kind: "income", category: "tax_refund", confidence: 0.9, label: "tax refund" },
  { pattern: /ביטוח לאומי/, direction: "in", kind: "income", category: "other_income", confidence: 0.85, label: "national insurance" },
  { pattern: /החזרת שיק|החזר שיק/, kind: "reversal", confidence: 0.85, label: "returned cheque" },
  { pattern: /משיכת מזומן|כספומט|מזומן/, direction: "out", kind: "cash_withdrawal", confidence: 0.9, label: "cash withdrawal" },
  { pattern: /ריבית זכות|דיבידנד/, direction: "in", kind: "income", category: "investment_income", confidence: 0.85, label: "interest/dividend" },
];

/** Merchant names, mainly for card transactions (and bank direct debits). */
export const MERCHANT_ENTRIES: DictionaryEntry[] = [
  { pattern: /שופרסל|רמי לוי|יוניברס|אושר עד|טיב טעם|סטופ מרקט|יוחננוף|ויקטורי|מחסני השוק|חצי חינם|יינות ביתן|קרפור|מגה בעיר|AM:PM|פרש מרקט/i, category: "groceries", confidence: 0.9, label: "supermarket" },
  { pattern: /wolt|וולט|תן ביס|10bis|japanika delivery/i, category: "delivery", confidence: 0.9, label: "food delivery" },
  { pattern: /סיבוס|cibus|פלאקסי/i, category: "dining", confidence: 0.85, label: "meal card" },
  { pattern: words("מקדונלד'?ס|מקדונלד|ארומה|קפה קפה|לנדוור|קפה גרג|בורגר|פיצה|פיצרייה|סושי|מסעדה|מסעדת|קפה|ביסטרו"), category: "dining", confidence: 0.8, label: "restaurant" },
  { pattern: words("סונול|דור אלון|דלק|טן|פז|yellow|יילו"), category: "fuel", confidence: 0.85, label: "fuel" },
  { pattern: /חניון|חניה|פנגו|pango|סלופארק|אחוזות החוף|מנהרות הכרמל|כביש 6|דרך ארץ|נתיבי איילון/i, category: "parking_tolls", confidence: 0.9, label: "parking/tolls" },
  { pattern: words("מוביט|moovit|רב[- ]?קו|גט טקסי|gett|yango|רכבת ישראל|אגד"), category: "transportation", confidence: 0.9, label: "transit" },
  { pattern: /netflix|spotify|apple\.com|icloud|disney|youtube|google one|chatgpt|openai|anthropic|claude\.ai/i, category: "subscriptions", confidence: 0.9, label: "digital subscription" },
  { pattern: /airbnb|booking|bkg\*|hotel|מלון|expedia|agoda|economycarrentals|rentalcars|אל על|el al|wizz|ryanair|ישראייר|ארקיע/i, category: "travel", confidence: 0.9, label: "travel" },
  { pattern: /aliexpress|amazon|shein|temu|ebay|asos/i, category: "shopping", confidence: 0.85, label: "online shopping" },
  { pattern: /zara|h&m|קסטרו|גולף|פוקס|fox|רנואר|טרמינל x|terminal x|נייק|adidas|אמריקן איגל/i, category: "clothing", confidence: 0.85, label: "clothing" },
  { pattern: /ksp|באג|ivory|איבורי|מחסני חשמל|שקם אלקטריק|אלקטרה/i, category: "electronics", confidence: 0.85, label: "electronics" },
  { pattern: words("ace|אייס|הום סנטר|איקאה|ikea|מקס סטוק|ביג מקס|טמבור|נעמן"), category: "home", confidence: 0.8, label: "home store" },
  // listed before healthcare: issuers sometimes file appliance service under health
  { pattern: words("סימנס|בוש|bosch|siemens|אלקטרולוקס|electrolux|שרות מוצרי חשמל"), category: "home", confidence: 0.8, label: "appliance service" },
  { pattern: /כללית|מכבי|מאוחדת|לאומית שירותי|בית חולים|רופא|מרפאה/i, category: "healthcare", confidence: 0.8, label: "health services" },
  { pattern: /סופר[- ]?פארם|super-?pharm|בי פארם|be pharm|פארמה/i, category: "pharmacy", confidence: 0.9, label: "pharmacy" },
  { pattern: words("הראל|מגדל|כלל|הפניקס|מנורה|איילון|הכשרה|ביטוח ישיר|ליברה|ווישור|ביטוח"), category: "insurance", confidence: 0.85, label: "insurer" },
  { pattern: words("חברת החשמל|חשמל לישראל|תאגיד מים|מי כרמל|מי אביבים|מי שבע|עירית|עיריית|ארנונה|סופרגז|אמישראגז|פזגז|שטראוס מים|תמי4"), category: "utilities", confidence: 0.85, label: "utility" },
  { pattern: words("בזק|פרטנר|partner|סלקום|cellcom|הוט|hot mobile|גולן טלקום|וויקום|we4g|פלאפון|yes"), category: "communication", confidence: 0.85, label: "telecom" },
  { pattern: /מס רכישה|מס שבח|רשות המסים|אגרה|משרד הפנים|רשות האוכלוסין|משרד התחבורה/, category: "taxes_fees", confidence: 0.9, label: "government" },
  // Pais Plus / "הטבות פיס" is a benefits club and gift voucher, not gambling
  { pattern: /פיס פלוס|הטבות פיס|תו נטען|תו קניה|תו שי/, category: "shopping", confidence: 0.75, label: "gift voucher" },
  { pattern: words("פיס מנויים|מפעל הפיס|פיס|טוטו|ווינר|winner|לוטו|הגרלה"), category: "lottery", confidence: 0.85, label: "lottery" },
  { pattern: /fever|סינמה|יס פלאנט|גלובוס מקס|cinema|הופעה|תיאטרון/i, category: "entertainment", confidence: 0.85, label: "entertainment" },
  { pattern: /free-?fit|הולמס פלייס|holmes|גו אקטיב|כושר|ספורט|ג'ים|gym/i, category: "sports", confidence: 0.85, label: "fitness" },
  { pattern: /בלינק|blink|אינטראקטיב|interactive brokers|מיטב|אלטשולר|פסגות|ifunds/i, kind: "savings_investment", confidence: 0.85, label: "investment platform" },
  { pattern: /^paybox|^pay ?box|פייבוקס/i, kind: "p2p_transfer", confidence: 0.8, label: "P2P wallet" },
  { pattern: /ספרים|סטימצקי|צומת ספרים|דפוס|אוניברסיט|מכללה|קורס/, category: "education", confidence: 0.8, label: "education/books" },
  { pattern: /מספרה|ספא|קוסמטיק|ציפורניים|barber/i, category: "personal_care", confidence: 0.8, label: "personal care" },
];

/**
 * Card issuers' own category labels (Isracard/Cal "ענף", Max "קטגוריה") -> our categories.
 * Labels too vague to use (e.g. "שונות") are deliberately absent.
 */
export const ISSUER_CATEGORY_MAP: Record<string, string> = {
  // Isracard
  "מכולת/סופר": "groceries",
  "מעדניות": "groceries",
  "מסעדות/קפה": "dining",
  "דלק": "fuel",
  "שירותי רכב": "car",
  "הלבשה": "clothing",
  "אבזרי אפנה": "clothing",
  "כלי בית": "home",
  "בניה/שיפוץ": "renovation",
  "מחשבים": "electronics",
  "תקשורת": "communication",
  "ביטוח": "insurance",
  "שרות רפואי": "healthcare",
  "פארמה": "pharmacy",
  "פנאי/ספורט": "entertainment",
  "תרבות": "entertainment",
  "טוטו/פיס": "lottery",
  "תש' רשויות": "taxes_fees",
  "קניה אינט'": "shopping",
  // Cal
  "מסעדות": "dining",
  "מזון ומשקאות": "groceries",
  "רכב ותחבורה": "transportation",
  "רפואה ובריאות": "healthcare",
  "ביטוח ופיננסים": "insurance",
  "תיירות": "travel",
  "מלונאות ואירוח": "travel",
  "פנאי בילוי": "entertainment",
  "אופנה": "clothing",
  "חשמל ומחשבים": "electronics",
  "ריהוט ובית": "home",
  "מוסדות": "taxes_fees",
  // Max
  "מזון וצריכה": "groceries",
  "מסעדות, קפה וברים": "dining",
  "דלק, חשמל וגז": "utilities",
  "פנאי, בידור וספורט": "entertainment",
  "ספרים ודפוס": "education",
  "אופנה וטיפוח": "clothing",
  "רפואה ופארם": "healthcare",
  "תחבורה ורכבים": "transportation",
  "טיסות ותיירות": "travel",
  "עירייה וממשלה": "taxes_fees",
  "חשמל ותקשורת": "communication",
  "עיצוב הבית": "home",
};

/** Some issuer labels describe how the purchase was made, not what it was; they can still settle the kind. */
export const TYPE_HINT_KINDS: Record<string, TransactionKind> = {
  "זיכוי": "refund",
};
