import Link from "next/link";
import { forecastFrom } from "@ft/analytics";
import type { Adjustment, Forecast, Range } from "@ft/core";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { money, monthName, parseShekels } from "@/lib/format";
import { periodHref, resolvePeriod } from "@/lib/period";

type Params = { month?: string; view?: string; horizon?: string; cut?: string; raise?: string; payment?: string; paymentMonths?: string; save?: string; purchase?: string; purchaseIn?: string };
const HORIZONS = [3, 6, 12];

function readScenario(p: Params, horizon: number): Adjustment[] {
  const out: Adjustment[] = [];
  const cut = parseShekels(p.cut);
  if (cut) out.push({ kind: "expense_change", monthlyMinor: -cut });
  const raise = Number(p.raise);
  if (p.raise && Number.isFinite(raise) && raise !== 0 && Math.abs(raise) <= 100) out.push({ kind: "income_change", pct: raise / 100 });
  const payment = parseShekels(p.payment);
  if (payment) out.push({ kind: "new_payment", monthlyMinor: payment, months: Number(p.paymentMonths) > 0 ? Number(p.paymentMonths) : undefined });
  const save = parseShekels(p.save);
  if (save) out.push({ kind: "extra_saving", monthlyMinor: save });
  const purchase = parseShekels(p.purchase);
  if (purchase) out.push({ kind: "one_off", amountMinor: purchase, monthIndex: Math.min(horizon - 1, Math.max(0, Number(p.purchaseIn) || 0)) });
  return out;
}

const range = (r: Range) => (
  <span className="num">
    {money(r.mid, { whole: true, signed: true })}
    <span className="muted small"> ({money(r.low, { whole: true })} עד {money(r.high, { whole: true })})</span>
  </span>
);

function End({ f, label }: { f: Forecast; label: string }) {
  const last = f.months[f.months.length - 1]!;
  return (
    <div className="card stack" style={{ "--gap": "6px", flex: "1 1 260px" } as React.CSSProperties}>
      <span className="muted small">{label}</span>
      {last.balance ? (
        <>
          <span className="kpi">{money(last.balance.mid, { whole: true })}</span>
          <span className="small muted">יתרת עו״ש צפויה ב{monthName(last.month)} · בין {money(last.balance.low, { whole: true })} ל-{money(last.balance.high, { whole: true })}</span>
        </>
      ) : (
        <>
          <span className="kpi">{money(last.cumulative.mid, { whole: true, signed: true })}</span>
          <span className="small muted">תזרים מצטבר עד {monthName(last.month)} (אין יתרת פתיחה ידועה)</span>
        </>
      )}
      {last.extraSavedMinor > 0n && <span className="small">+ {money(last.extraSavedMinor, { whole: true })} שהועברו לחיסכון</span>}
    </div>
  );
}

export default async function ForecastPage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const horizon = HORIZONS.includes(Number(params.horizon)) ? Number(params.horizon) : 6;
  const adjustments = readScenario(params, horizon);
  const { period, base, scenario } = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    return {
      period,
      base: await forecastFrom(tx, period.filters, period.month, horizon),
      scenario: adjustments.length ? await forecastFrom(tx, period.filters, period.month, horizon, adjustments) : null,
    };
  });
  const shown = scenario ?? base;
  const purchase = adjustments.find((a) => a.kind === "one_off");
  const lowest = shown.months.reduce<bigint | null>((min, m) => {
    const v = m.balance ? m.balance.low : m.cumulative.low;
    return min === null || v < min ? v : min;
  }, null);

  return (
    <>
      <ScopeBar path="/forecast" period={period} title="תחזית" />
      <nav className="tabs" aria-label="טווח">
        {HORIZONS.map((h) => (
          <Link key={h} href={periodHref("/forecast", period, { horizon: String(h) })} aria-current={h === horizon ? "page" : undefined}>{h} חודשים</Link>
        ))}
      </nav>

      {base.status === "insufficient" ? (
        <div className="card">
          תחזית נבנית מלפחות 3 חודשים מלאים (עם הכנסות והוצאות), כדי לא לנחש. כרגע יש {base.historyMonths}. ייבוא דוחות של חודשים נוספים יאפשר תחזית.
        </div>
      ) : (
        <>
          <div className="row" style={{ alignItems: "stretch" }}>
            <End f={base} label="בלי שינוי" />
            {scenario && <End f={scenario} label="עם התרחיש" />}
          </div>

          {purchase && lowest !== null && (
            <div role="note" className={`banner ${lowest >= 0n ? "ok" : "warn"}`}>
              {lowest >= 0n
                ? `גם בתרחיש הפסימי ${shown.months[0]!.balance ? "היתרה" : "התזרים המצטבר"} לא יורד מתחת ל-${money(lowest, { whole: true })} אחרי הרכישה.`
                : `בתרחיש הפסימי ${shown.months[0]!.balance ? "היתרה" : "התזרים המצטבר"} עלול לרדת ל-${money(lowest, { whole: true })} אחרי הרכישה. כדאי לדחות, לפרוס או לחסוך לה קודם.`}
            </div>
          )}

          <section className="card" style={{ padding: "6px 4px" }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col">חודש</th><th scope="col">הכנסות</th><th scope="col">הוצאות</th><th scope="col">תזרים</th><th scope="col">{shown.months[0]!.balance ? "יתרה צפויה" : "מצטבר"}</th></tr>
                </thead>
                <tbody>
                  {shown.months.map((m) => (
                    <tr key={m.month}>
                      <td>{monthName(m.month)}</td>
                      <td className="num">{money(m.income.mid, { whole: true })}</td>
                      <td className="num">{money(m.expenses.mid, { whole: true })}</td>
                      <td>{range(m.net)}</td>
                      <td>{range(m.balance ?? m.cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="card" open>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>על מה התחזית מבוססת</summary>
            <ul className="small" style={{ lineHeight: 1.7 }}>
              <li>{shown.historyMonths} חודשים מלאים אחרונים.</li>
              <li>הכנסה חודשית צפויה: {money(shown.assumptions.incomeMinor, { whole: true })} (מתוכה הכנסה קבועה {money(shown.assumptions.recurringIncomeMinor, { whole: true })}).</li>
              <li>חיובים קבועים ותשלומים: {money(shown.assumptions.fixedPaymentsMinor, { whole: true })} בחודש; תשלומים שמסתיימים יורדים מהתחזית בחודש האחרון שלהם.</li>
              {shown.assumptions.endingInstallments.length > 0 && <li>מסתיימים: {shown.assumptions.endingInstallments.map((e) => `${e.label} (${monthName(e.lastMonth)})`).join(", ")}.</li>}
              <li>הוצאה משתנה: חציון של {money(shown.assumptions.variableSpendingMinor, { whole: true })}; הטווח בסוגריים הוא בין החודשים החלשים לחזקים בהיסטוריה, ומתרחב ככל שמתרחקים.</li>
              <li>עונתיות (חגים, חופשות) לא נלקחת בחשבון עד שיהיו 12 חודשי נתונים.</li>
            </ul>
          </details>
        </>
      )}

      <form method="get" className="card stack">
        <h2>מה אם…</h2>
        <input type="hidden" name="month" value={period.month} />
        <input type="hidden" name="horizon" value={horizon} />
        {period.view && <input type="hidden" name="view" value={period.view} />}
        <div className="grid">
          <div className="field-group"><label htmlFor="cut">נוציא פחות בכל חודש (₪)</label><input className="field num" id="cut" name="cut" defaultValue={params.cut ?? ""} inputMode="decimal" dir="ltr" /></div>
          <div className="field-group"><label htmlFor="raise">שינוי בהכנסה (%)</label><input className="field num" id="raise" name="raise" type="number" min={-100} max={100} defaultValue={params.raise ?? ""} dir="ltr" /></div>
          <div className="field-group"><label htmlFor="payment">תשלום חודשי חדש (₪), למשל רכב</label><input className="field num" id="payment" name="payment" defaultValue={params.payment ?? ""} inputMode="decimal" dir="ltr" /></div>
          <div className="field-group"><label htmlFor="paymentMonths">למשך חודשים (ריק = כל התקופה)</label><input className="field num" id="paymentMonths" name="paymentMonths" type="number" min={1} defaultValue={params.paymentMonths ?? ""} dir="ltr" /></div>
          <div className="field-group"><label htmlFor="save">נחסוך עוד כל חודש (₪)</label><input className="field num" id="save" name="save" defaultValue={params.save ?? ""} inputMode="decimal" dir="ltr" /></div>
          <div className="field-group"><label htmlFor="purchase">רכישה חד-פעמית (₪)</label><input className="field num" id="purchase" name="purchase" defaultValue={params.purchase ?? ""} inputMode="decimal" dir="ltr" /></div>
          <div className="field-group">
            <label htmlFor="purchaseIn">בחודש</label>
            <select className="field" id="purchaseIn" name="purchaseIn" defaultValue={params.purchaseIn ?? "0"}>
              {base.months.map((m, i) => <option key={m.month} value={i}>{monthName(m.month)}</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <button className="btn primary" type="submit">חישוב</button>
          {adjustments.length > 0 && <Link href={periodHref("/forecast", period, { horizon: String(horizon) })}>ניקוי התרחיש</Link>}
        </div>
      </form>
    </>
  );
}
