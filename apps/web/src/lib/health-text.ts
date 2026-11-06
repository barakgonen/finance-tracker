import type { HealthDimension, HealthDimensionKey } from "@ft/core";

type Formatter = (v: number, monthsUsed: number) => string;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Name, measured value in words, and an improvement suggestion per dimension. */
export const DIMENSIONS: Record<HealthDimensionKey, { name: string; value: Formatter; threshold: (v: number) => string; suggestion: string }> = {
  savings_rate: {
    name: "שיעור חיסכון",
    value: (v) => `${pct(v)} מההכנסה נשארו בסוף החודש`,
    threshold: pct,
    suggestion: "להעביר סכום קבוע לחיסכון ביום שהמשכורת נכנסת, ולבדוק אילו קטגוריות עלו לאחרונה (בדף התובנות).",
  },
  expense_ratio: {
    name: "הוצאות ביחס להכנסה",
    value: (v) => `ההוצאות הן ${pct(v)} מההכנסה`,
    threshold: pct,
    suggestion: "לבחור 2–3 קטגוריות ההוצאה הגדולות ולהציב להן תקציב חודשי.",
  },
  cashflow_stability: {
    name: "יציבות התזרים",
    value: (v, months) => `${Math.round(v * months)} מתוך ${months} חודשים הסתיימו ביתרה`,
    threshold: pct,
    suggestion: "לפזר הוצאות גדולות לאורך כמה חודשים, ולבנות כרית שתספוג חודשים חלשים.",
  },
  fixed_costs: {
    name: "התחייבויות קבועות",
    value: (v) => `חיובים קבועים ותשלומים הם ${pct(v)} מההכנסה`,
    threshold: pct,
    suggestion: "לעבור על החיובים הקבועים והמנויים, ולשקול מה אפשר לבטל או להוזיל.",
  },
  spending_consistency: {
    name: "יציבות ההוצאות",
    value: (v) => `ההוצאה החודשית סוטה בממוצע ב-${pct(v)}`,
    threshold: pct,
    suggestion: "לתכנן מראש הוצאות עונתיות (חגים, חופשות, ביטוחים שנתיים) ולהפריש להן כל חודש.",
  },
  debt: {
    name: "החזרי הלוואות",
    value: (v) => (v === 0 ? "לא זוהו החזרי הלוואות" : `החזרי הלוואות ומשכנתא הם ${pct(v)} מההכנסה`),
    threshold: pct,
    suggestion: "לבדוק מחזור של הלוואה יקרה או פירעון מוקדם שלה.",
  },
  emergency_fund: {
    name: "כרית ביטחון",
    value: (v) => `יתרת העו״ש מכסה ${v.toFixed(1)} חודשי הוצאות`,
    threshold: (v) => `${v} חודשים`,
    suggestion: "לבנות כרית של 3–6 חודשי הוצאות בחשבון נזיל.",
  },
  goals: {
    name: "התקדמות ביעדים",
    value: (v) => `${pct(v)} מהיעדים הושגו`,
    threshold: pct,
    suggestion: "להגדיר יעד חיסכון ולעקוב אחריו.",
  },
};

export const MISSING: Record<NonNullable<HealthDimension["missing"]>, string> = {
  too_few_months: "צריך לפחות 3 חודשים מלאים (עם הכנסות והוצאות)",
  no_income: "אין מספיק נתוני הכנסה",
  no_balance: "אין יתרת חשבון ידועה (תגיע עם ייבוא דוח בנק)",
  no_bank_data: "לא יובאו דוחות בנק, ולכן אי אפשר לדעת על הלוואות",
  no_goals: "עדיין אין יעדים (יתווספו בשלב הבא)",
};

export const EFFECT = { positive: "תורם לציון", negative: "מוריד את הציון", neutral: "בינוני", unknown: "" } as const;
export const CONFIDENCE = { high: "ביטחון גבוה", medium: "ביטחון בינוני", low: "ביטחון נמוך" } as const;
