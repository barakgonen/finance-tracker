import type { Insight } from "@ft/core";
import { date, money } from "./format";
import { CONFIDENCE } from "./health-text";
import { L, categoryName } from "./locale";
import { periodHref, type Period } from "./period";

export interface InsightView {
  title: string;
  what: string;
  why: string;
  impact: string | null;
  action: { label: string; href: string };
  confidence: string;
}

const m = (v: string | number) => money(Number(v), { whole: true });

/** Wording for each detector (in the request's language): what was found, why it matters, the money, and what to do. */
export function describeInsight(i: Insight, period: Pick<Period, "month" | "view">): InsightView {
  const p = i.params;
  const tx = (q: Record<string, string>) => periodHref("/transactions", period, q);
  const impact = i.monthlyImpactMinor !== null ? L(`כ-${m(i.monthlyImpactMinor.toString())} בחודש`, `about ${m(i.monthlyImpactMinor.toString())} a month`) : i.oneOffMinor !== null ? L(`${m(i.oneOffMinor.toString())} חד-פעמי`, `${m(i.oneOffMinor.toString())} one-off`) : null;
  const base = { impact, confidence: CONFIDENCE[i.confidence] };
  switch (i.detector) {
    case "category_spike":
      return {
        ...base,
        title: L(`${p.category}: ${p.percent}% מעל הממוצע`, `${categoryName(String(p.category))}: ${p.percent}% above average`),
        what: L(`החודש ${m(p.current!)}, לעומת ממוצע של ${m(p.average!)} ב-${p.months} החודשים הקודמים.`, `${m(p.current!)} this month, vs. an average of ${m(p.average!)} over the previous ${p.months} months.`),
        why: L("אם זו הרמה החדשה, ההפרש מצטבר לאורך השנה.", "If this is the new level, the difference adds up over the year."),
        action: { label: L("הצגת העסקאות", "Show the purchases"), href: tx({ side: "spending", category: i.categorySlug! }) },
      };
    case "subscriptions":
      return {
        ...base,
        title: L(`מנויים: ${m(p.monthly!)} בחודש`, `Subscriptions: ${m(p.monthly!)} a month`),
        what: L(`${p.count} מנויים פעילים: ${p.names}.`, `${p.count} active subscriptions: ${p.names}.`),
        why: L(`יחד ${m(p.annual!)} בשנה. מנוי שלא משתמשים בו הוא חיסכון קל.`, `Together ${m(p.annual!)} a year. An unused subscription is an easy saving.`),
        action: { label: L("סקירת החיובים הקבועים", "Review recurring charges"), href: periodHref("/recurring", period) },
      };
    case "price_increase":
      return {
        ...base,
        title: L(`${p.name} התייקר ב-${p.percent}%`, `${p.name} went up ${p.percent}%`),
        what: L(`החיוב עלה מ-${m(p.before!)} ל-${m(p.now!)}.`, `The charge went from ${m(p.before!)} to ${m(p.now!)}.`),
        why: L("התייקרות בחיוב קבוע ממשיכה כל חודש, גם אם לא שמים לב אליה.", "A higher recurring charge keeps costing every month, even unnoticed."),
        action: { label: L("סקירת החיובים הקבועים", "Review recurring charges"), href: periodHref("/recurring", period) },
      };
    case "duplicate_charge":
      return {
        ...base,
        title: L(`חיוב כפול אפשרי: ${p.name}`, `Possible double charge: ${p.name}`),
        what: L(`${m(p.amount!)} נגבה פעמיים, ב-${date(String(p.date))}.`, `${m(p.amount!)} was charged twice, on ${date(String(p.date))}.`),
        why: L("אם זו טעות של בית העסק, אפשר לבקש החזר דרך חברת האשראי.", "If the merchant made a mistake, you can ask for a refund through the card company."),
        action: { label: L("הצגת החיובים", "Show the charges"), href: tx({ side: "spending", merchant: i.merchantKey! }) },
      };
    case "unusual_transaction":
      return {
        ...base,
        title: L(`עסקה חריגה: ${p.name}`, `Unusual purchase: ${p.name}`),
        what: L(`${m(p.amount!)}, פי ${p.times} מעסקה רגילה בקטגוריה (בדרך כלל ${m(p.typical!)}).`, `${m(p.amount!)}, ${p.times}× a usual purchase in this category (typically ${m(p.typical!)}).`),
        why: L("כדאי לוודא שהעסקה מוכרת ונכונה.", "Worth checking that you recognize it and it's correct."),
        action: { label: L("הצגת הקטגוריה", "Show the category"), href: tx({ side: "spending", category: i.categorySlug! }) },
      };
    case "savings_drop":
      return {
        ...base,
        title: L(`שיעור החיסכון ירד ל-${p.rate}%`, `Savings rate dropped to ${p.rate}%`),
        what: L(`לעומת ממוצע של ${p.average}% ב-${p.months} החודשים הקודמים.`, `vs. an average of ${p.average}% over the previous ${p.months} months.`),
        why: L("ירידה חד-פעמית יכולה לנבוע מהוצאה גדולה; ירידה מתמשכת משנה את התמונה השנתית.", "A one-off drop can come from a large expense; a lasting drop changes the yearly picture."),
        action: { label: L("תזרים מלא", "Full cash flow"), href: periodHref("/cashflow", period) },
      };
  }
}
