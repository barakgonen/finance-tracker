import type { HealthDimension, HealthDimensionKey } from "@ft/core";
import { L } from "./locale";

type Formatter = (v: number, monthsUsed: number) => string;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Name, measured value in words, and an improvement suggestion per dimension. */
export const DIMENSIONS: Record<HealthDimensionKey, { name: string; value: Formatter; threshold: (v: number) => string; suggestion: string }> = {
  savings_rate: {
    get name() {
      return L("שיעור חיסכון", "Savings rate");
    },
    value: (v) => L(`${pct(v)} מההכנסה נשארו בסוף החודש`, `${pct(v)} of income was left at month end`),
    threshold: pct,
    get suggestion() {
      return L("להעביר סכום קבוע לחיסכון ביום שהמשכורת נכנסת, ולבדוק אילו קטגוריות עלו לאחרונה (בדף התובנות).", "Move a fixed amount to savings on payday, and check which categories went up recently (on the insights page).");
    },
  },
  expense_ratio: {
    get name() {
      return L("הוצאות ביחס להכנסה", "Expenses vs. income");
    },
    value: (v) => L(`ההוצאות הן ${pct(v)} מההכנסה`, `Expenses are ${pct(v)} of income`),
    threshold: pct,
    get suggestion() {
      return L("לבחור 2–3 קטגוריות ההוצאה הגדולות ולהציב להן תקציב חודשי.", "Pick the 2–3 largest spending categories and give them a monthly budget.");
    },
  },
  cashflow_stability: {
    get name() {
      return L("יציבות התזרים", "Cash flow stability");
    },
    value: (v, months) => L(`${Math.round(v * months)} מתוך ${months} חודשים הסתיימו ביתרה`, `${Math.round(v * months)} of ${months} months ended with money left`),
    threshold: pct,
    get suggestion() {
      return L("לפזר הוצאות גדולות לאורך כמה חודשים, ולבנות כרית שתספוג חודשים חלשים.", "Spread large expenses over several months, and build a cushion for weak months.");
    },
  },
  fixed_costs: {
    get name() {
      return L("התחייבויות קבועות", "Fixed commitments");
    },
    value: (v) => L(`חיובים קבועים ותשלומים הם ${pct(v)} מההכנסה`, `Recurring charges and installments are ${pct(v)} of income`),
    threshold: pct,
    get suggestion() {
      return L("לעבור על החיובים הקבועים והמנויים, ולשקול מה אפשר לבטל או להוזיל.", "Go over recurring charges and subscriptions, and consider what to cancel or make cheaper.");
    },
  },
  spending_consistency: {
    get name() {
      return L("יציבות ההוצאות", "Spending consistency");
    },
    value: (v) => L(`ההוצאה החודשית סוטה בממוצע ב-${pct(v)}`, `Monthly spending varies by ${pct(v)} on average`),
    threshold: pct,
    get suggestion() {
      return L("לתכנן מראש הוצאות עונתיות (חגים, חופשות, ביטוחים שנתיים) ולהפריש להן כל חודש.", "Plan seasonal expenses ahead (holidays, vacations, yearly insurance) and set money aside for them monthly.");
    },
  },
  debt: {
    get name() {
      return L("החזרי הלוואות", "Loan repayments");
    },
    value: (v) => (v === 0 ? L("לא זוהו החזרי הלוואות", "No loan repayments found") : L(`החזרי הלוואות ומשכנתא הם ${pct(v)} מההכנסה`, `Loan and mortgage repayments are ${pct(v)} of income`)),
    threshold: pct,
    get suggestion() {
      return L("לבדוק מחזור של הלוואה יקרה או פירעון מוקדם שלה.", "Look into refinancing an expensive loan or repaying it early.");
    },
  },
  emergency_fund: {
    get name() {
      return L("כרית ביטחון", "Emergency fund");
    },
    value: (v) => L(`יתרת העו״ש מכסה ${v.toFixed(1)} חודשי הוצאות`, `The bank balance covers ${v.toFixed(1)} months of expenses`),
    threshold: (v) => L(`${v} חודשים`, `${v} months`),
    get suggestion() {
      return L("לבנות כרית של 3–6 חודשי הוצאות בחשבון נזיל.", "Build a cushion of 3–6 months of expenses in an accessible account.");
    },
  },
  goals: {
    get name() {
      return L("התקדמות ביעדים", "Goal progress");
    },
    value: (v) => L(`${pct(v)} מהיעדים הושגו`, `${pct(v)} of goals achieved`),
    threshold: pct,
    get suggestion() {
      return L("להגדיר יעד חיסכון ולעקוב אחריו.", "Set a savings goal and track it.");
    },
  },
};

export const MISSING: Record<NonNullable<HealthDimension["missing"]>, string> = {
  get too_few_months() {
    return L("צריך לפחות 3 חודשים מלאים (עם הכנסות והוצאות)", "Needs at least 3 complete months (with income and expenses)");
  },
  get no_income() {
    return L("אין מספיק נתוני הכנסה", "Not enough income data");
  },
  get no_balance() {
    return L("אין יתרת חשבון ידועה (תגיע עם ייבוא דוח בנק)", "No known account balance (comes with a bank statement import)");
  },
  get no_bank_data() {
    return L("לא יובאו דוחות בנק, ולכן אי אפשר לדעת על הלוואות", "No bank statements imported, so loans can't be known");
  },
  get no_goals() {
    return L("עדיין אין יעדים (יתווספו בשלב הבא)", "No goals yet");
  },
};

export const EFFECT = {
  get positive() { return L("תורם לציון", "Helps the score"); },
  get negative() { return L("מוריד את הציון", "Lowers the score"); },
  get neutral() { return L("בינוני", "Average"); },
  unknown: "",
};
export const CONFIDENCE = {
  get high() { return L("ביטחון גבוה", "High confidence"); },
  get medium() { return L("ביטחון בינוני", "Medium confidence"); },
  get low() { return L("ביטחון נמוך", "Low confidence"); },
};
