import Link from "next/link";
import { forecastFrom } from "@ft/analytics";
import type { Adjustment, Forecast, Range } from "@ft/core";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { money, monthName, parseShekels } from "@/lib/format";
import { periodHref, resolvePeriod } from "@/lib/period";
import { L } from "@/lib/locale";

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
    <span className="muted small"> ({money(r.low, { whole: true })} {L("עד", "to")} {money(r.high, { whole: true })})</span>
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
          <span className="small muted">{L("יתרת עו״ש צפויה ב", "Expected bank balance in ")}{monthName(last.month)} · {L("בין", "between")} {money(last.balance.low, { whole: true })} {L("ל-", "and ")}{money(last.balance.high, { whole: true })}</span>
        </>
      ) : (
        <>
          <span className="kpi">{money(last.cumulative.mid, { whole: true, signed: true })}</span>
          <span className="small muted">{L("תזרים מצטבר עד", "Cumulative cash flow to")} {monthName(last.month)} ({L("אין יתרת פתיחה ידועה", "no known opening balance")})</span>
        </>
      )}
      {last.extraSavedMinor > 0n && <span className="small">+ {money(last.extraSavedMinor, { whole: true })} {L("שהועברו לחיסכון", "moved to savings")}</span>}
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
      <ScopeBar path="/forecast" period={period} title={L("תחזית", "Forecast")} />
      <nav className="tabs" aria-label={L("טווח", "Range")}>
        {HORIZONS.map((h) => (
          <Link key={h} href={periodHref("/forecast", period, { horizon: String(h) })} aria-current={h === horizon ? "page" : undefined}>{h} {L("חודשים", "months")}</Link>
        ))}
      </nav>

      {base.status === "insufficient" ? (
        <div className="card">
          {L(
            `תחזית נבנית מלפחות 3 חודשים מלאים (עם הכנסות והוצאות), כדי לא לנחש. כרגע יש ${base.historyMonths}. ייבוא דוחות של חודשים נוספים יאפשר תחזית.`,
            `A forecast needs at least 3 complete months (with income and expenses), so it doesn't guess. There are ${base.historyMonths} so far. Importing more months will enable it.`,
          )}
        </div>
      ) : (
        <>
          <div className="row" style={{ alignItems: "stretch" }}>
            <End f={base} label={L("בלי שינוי", "No change")} />
            {scenario && <End f={scenario} label={L("עם התרחיש", "With the scenario")} />}
          </div>

          {purchase && lowest !== null && (
            <div role="note" className={`banner ${lowest >= 0n ? "ok" : "warn"}`}>
              {lowest >= 0n
                ? L(
                    `גם בתרחיש הפסימי ${shown.months[0]!.balance ? "היתרה" : "התזרים המצטבר"} לא יורד מתחת ל-${money(lowest, { whole: true })} אחרי הרכישה.`,
                    `Even in the pessimistic case, the ${shown.months[0]!.balance ? "balance" : "cumulative cash flow"} doesn't drop below ${money(lowest, { whole: true })} after the purchase.`,
                  )
                : L(
                    `בתרחיש הפסימי ${shown.months[0]!.balance ? "היתרה" : "התזרים המצטבר"} עלול לרדת ל-${money(lowest, { whole: true })} אחרי הרכישה. כדאי לדחות, לפרוס או לחסוך לה קודם.`,
                    `In the pessimistic case, the ${shown.months[0]!.balance ? "balance" : "cumulative cash flow"} could drop to ${money(lowest, { whole: true })} after the purchase. Consider postponing it, paying in installments, or saving for it first.`,
                  )}
            </div>
          )}

          <section className="card" style={{ padding: "6px 4px" }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col">{L("חודש", "Month")}</th><th scope="col">{L("הכנסות", "Income")}</th><th scope="col">{L("הוצאות", "Expenses")}</th><th scope="col">{L("תזרים", "Cash flow")}</th><th scope="col">{shown.months[0]!.balance ? L("יתרה צפויה", "Expected balance") : L("מצטבר", "Cumulative")}</th></tr>
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
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>{L("על מה התחזית מבוססת", "What the forecast is based on")}</summary>
            <ul className="small" style={{ lineHeight: 1.7 }}>
              <li>{L(`${shown.historyMonths} חודשים מלאים אחרונים.`, `The last ${shown.historyMonths} complete months.`)}</li>
              <li>
                {L("הכנסה חודשית צפויה", "Expected monthly income")}: {money(shown.assumptions.incomeMinor, { whole: true })} ({L("מתוכה הכנסה קבועה", "of which recurring")} {money(shown.assumptions.recurringIncomeMinor, { whole: true })}).
              </li>
              <li>
                {L("חיובים קבועים ותשלומים", "Recurring charges and installments")}: {money(shown.assumptions.fixedPaymentsMinor, { whole: true })}{" "}
                {L("בחודש; תשלומים שמסתיימים יורדים מהתחזית בחודש האחרון שלהם.", "a month; ending installments drop out of the forecast after their last month.")}
              </li>
              {shown.assumptions.endingInstallments.length > 0 && <li>{L("מסתיימים", "Ending")}: {shown.assumptions.endingInstallments.map((e) => `${e.label} (${monthName(e.lastMonth)})`).join(", ")}.</li>}
              <li>
                {L("הוצאה משתנה: חציון של", "Variable spending: a median of")} {money(shown.assumptions.variableSpendingMinor, { whole: true })};{" "}
                {L("הטווח בסוגריים הוא בין החודשים החלשים לחזקים בהיסטוריה, ומתרחב ככל שמתרחקים.", "the range in brackets spans the weakest to strongest months in the history, and widens further out.")}
              </li>
              <li>{L("עונתיות (חגים, חופשות) לא נלקחת בחשבון עד שיהיו 12 חודשי נתונים.", "Seasonality (holidays, vacations) isn't considered until there are 12 months of data.")}</li>
            </ul>
          </details>
        </>
      )}

      <form method="get" className="card stack">
        <h2>{L("מה אם…", "What if…")}</h2>
        <input type="hidden" name="month" value={period.month} />
        <input type="hidden" name="horizon" value={horizon} />
        {period.view && <input type="hidden" name="view" value={period.view} />}
        <div className="grid">
          <div className="field-group"><label htmlFor="cut">{L("נוציא פחות בכל חודש (₪)", "Spend less each month (₪)")}</label><input className="field num" id="cut" name="cut" defaultValue={params.cut ?? ""} inputMode="decimal" dir="ltr" /></div>
          <div className="field-group"><label htmlFor="raise">{L("שינוי בהכנסה (%)", "Change in income (%)")}</label><input className="field num" id="raise" name="raise" type="number" min={-100} max={100} defaultValue={params.raise ?? ""} dir="ltr" /></div>
          <div className="field-group"><label htmlFor="payment">{L("תשלום חודשי חדש (₪), למשל רכב", "New monthly payment (₪), e.g. a car")}</label><input className="field num" id="payment" name="payment" defaultValue={params.payment ?? ""} inputMode="decimal" dir="ltr" /></div>
          <div className="field-group"><label htmlFor="paymentMonths">{L("למשך חודשים (ריק = כל התקופה)", "For how many months (empty = the whole period)")}</label><input className="field num" id="paymentMonths" name="paymentMonths" type="number" min={1} defaultValue={params.paymentMonths ?? ""} dir="ltr" /></div>
          <div className="field-group"><label htmlFor="save">{L("נחסוך עוד כל חודש (₪)", "Save more each month (₪)")}</label><input className="field num" id="save" name="save" defaultValue={params.save ?? ""} inputMode="decimal" dir="ltr" /></div>
          <div className="field-group"><label htmlFor="purchase">{L("רכישה חד-פעמית (₪)", "One-time purchase (₪)")}</label><input className="field num" id="purchase" name="purchase" defaultValue={params.purchase ?? ""} inputMode="decimal" dir="ltr" /></div>
          <div className="field-group">
            <label htmlFor="purchaseIn">{L("בחודש", "In month")}</label>
            <select className="field" id="purchaseIn" name="purchaseIn" defaultValue={params.purchaseIn ?? "0"}>
              {base.months.map((m, i) => <option key={m.month} value={i}>{monthName(m.month)}</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <button className="btn primary" type="submit">{L("חישוב", "Calculate")}</button>
          {adjustments.length > 0 && <Link href={periodHref("/forecast", period, { horizon: String(horizon) })}>{L("ניקוי התרחיש", "Clear scenario")}</Link>}
        </div>
      </form>
    </>
  );
}
