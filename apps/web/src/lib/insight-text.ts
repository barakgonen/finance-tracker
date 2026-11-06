import type { Insight } from "@ft/core";
import { date, money } from "./format";
import { periodHref, type Period } from "./period";

export interface InsightView {
  title: string;
  what: string;
  why: string;
  impact: string | null;
  action: { label: string; href: string };
  confidence: string;
}

const CONFIDENCE = { high: "ביטחון גבוה", medium: "ביטחון בינוני", low: "ביטחון נמוך" } as const;
const m = (v: string | number) => money(Number(v), { whole: true });

/** Hebrew wording for each detector: what was found, why it matters, the money, and what to do. */
export function describeInsight(i: Insight, period: Pick<Period, "month" | "view">): InsightView {
  const p = i.params;
  const tx = (q: Record<string, string>) => periodHref("/transactions", period, q);
  const impact = i.monthlyImpactMinor !== null ? `כ-${m(i.monthlyImpactMinor.toString())} בחודש` : i.oneOffMinor !== null ? `${m(i.oneOffMinor.toString())} חד-פעמי` : null;
  const base = { impact, confidence: CONFIDENCE[i.confidence] };
  switch (i.detector) {
    case "category_spike":
      return {
        ...base,
        title: `${p.category}: ${p.percent}% מעל הממוצע`,
        what: `החודש ${m(p.current!)}, לעומת ממוצע של ${m(p.average!)} ב-${p.months} החודשים הקודמים.`,
        why: "אם זו הרמה החדשה, ההפרש מצטבר לאורך השנה.",
        action: { label: "הצגת העסקאות", href: tx({ side: "spending", category: i.categorySlug! }) },
      };
    case "subscriptions":
      return {
        ...base,
        title: `מנויים: ${m(p.monthly!)} בחודש`,
        what: `${p.count} מנויים פעילים: ${p.names}.`,
        why: `יחד ${m(p.annual!)} בשנה. מנוי שלא משתמשים בו הוא חיסכון קל.`,
        action: { label: "סקירת החיובים הקבועים", href: periodHref("/recurring", period) },
      };
    case "price_increase":
      return {
        ...base,
        title: `${p.name} התייקר ב-${p.percent}%`,
        what: `החיוב עלה מ-${m(p.before!)} ל-${m(p.now!)}.`,
        why: "התייקרות בחיוב קבוע ממשיכה כל חודש, גם אם לא שמים לב אליה.",
        action: { label: "סקירת החיובים הקבועים", href: periodHref("/recurring", period) },
      };
    case "duplicate_charge":
      return {
        ...base,
        title: `חיוב כפול אפשרי: ${p.name}`,
        what: `${m(p.amount!)} נגבה פעמיים, ב-${date(String(p.date))}.`,
        why: "אם זו טעות של בית העסק, אפשר לבקש החזר דרך חברת האשראי.",
        action: { label: "הצגת החיובים", href: tx({ side: "spending", merchant: i.merchantKey! }) },
      };
    case "unusual_transaction":
      return {
        ...base,
        title: `עסקה חריגה: ${p.name}`,
        what: `${m(p.amount!)}, פי ${p.times} מעסקה רגילה בקטגוריה (בדרך כלל ${m(p.typical!)}).`,
        why: "כדאי לוודא שהעסקה מוכרת ונכונה.",
        action: { label: "הצגת הקטגוריה", href: tx({ side: "spending", category: i.categorySlug! }) },
      };
    case "savings_drop":
      return {
        ...base,
        title: `שיעור החיסכון ירד ל-${p.rate}%`,
        what: `לעומת ממוצע של ${p.average}% ב-${p.months} החודשים הקודמים.`,
        why: "ירידה חד-פעמית יכולה לנבוע מהוצאה גדולה; ירידה מתמשכת משנה את התמונה השנתית.",
        action: { label: "תזרים מלא", href: periodHref("/cashflow", period) },
      };
  }
}
