import Link from "next/link";
import { recurringSeries, upcoming, type RecurringWithCategory } from "@ft/analytics";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { date, money } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import { L, categoryName } from "@/lib/locale";

const cadenceName = (c: "weekly" | "monthly" | "bimonthly" | "yearly") =>
  ({ weekly: L("שבועי", "Weekly"), monthly: L("חודשי", "Monthly"), bimonthly: L("דו-חודשי", "Every 2 months"), yearly: L("שנתי", "Yearly") })[c];

function Table({ rows, showRemaining }: { rows: RecurringWithCategory[]; showRemaining?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{L("שם", "Name")}</th><th scope="col">{L("תדירות", "Frequency")}</th><th scope="col">{L("סכום", "Amount")}</th><th scope="col">{L("בחודש", "Per month")}</th>
            {showRemaining ? <th scope="col">{L("נותרו", "Remaining")}</th> : <th scope="col">{L("בשנה", "Per year")}</th>}
            <th scope="col">{L("החיוב הבא", "Next charge")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.key}>
              <td>
                {s.merchantId ? <Link href={`/merchants/${s.merchantId}`}>{s.label}</Link> : s.label}
                {s.categoryName ? <span className="muted small"> · {categoryName(s.categoryName)}</span> : null}
                {s.previousTypicalMinor !== null && s.lastAmountMinor > s.previousTypicalMinor ? <span className="chip warn" style={{ marginInlineStart: 8 }}>{L("התייקר", "Went up")}</span> : null}
              </td>
              <td className="small">{cadenceName(s.cadence)}{s.confidence === "medium" ? <span className="muted"> · {L("משוער", "estimated")}</span> : null}</td>
              <td className="num">{money(s.amountMinor)}{s.amountVariation > 0.05 ? <span className="muted small"> ({L("משתנה", "varies")})</span> : null}</td>
              <td className="num">{money(s.monthlyMinor, { whole: true })}</td>
              {showRemaining ? (
                <td className="num">{s.installments!.remaining} {L("מתוך", "of")} {s.installments!.total}</td>
              ) : (
                <td className="num">{money(s.annualMinor, { whole: true })}</td>
              )}
              <td className="num">{s.active ? date(s.nextDate) : <span className="muted">{L("הסתיים", "Ended")}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function RecurringPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const { period, series } = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    return { period, series: await recurringSeries(tx, period.filters, period.month) };
  });
  const payments = series.filter((s) => s.direction === "out" && !s.installments && s.active);
  const plans = series.filter((s) => s.installments && s.active);
  const income = series.filter((s) => s.direction === "in" && s.active);
  const ended = series.filter((s) => !s.active);
  const monthly = [...payments, ...plans].reduce((a, s) => a + s.monthlyMinor, 0n);
  const today = new Date().toISOString().slice(0, 10);
  const from = `${period.month}-28` < today ? `${period.month}-28` : today;
  const next = upcoming(series, from, 30);

  return (
    <>
      <ScopeBar path="/recurring" period={period} title={L("חיובים קבועים", "Recurring")} />
      <p className="muted small" style={{ margin: 0 }}>
        {L("חיוב נחשב קבוע אחרי לפחות 3 פעמים במרווח קבוע ובסכום דומה. עסקאות בתשלומים מזוהות מהדוח עצמו.", "A charge counts as recurring after at least 3 times at a regular interval and a similar amount. Installment plans are read from the statement itself.")}
      </p>
      <section className="grid">
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">{L("חיובים קבועים בחודש", "Recurring charges per month")}</span>
          <span className="kpi">{money(monthly, { whole: true })}</span>
          <span className="small muted">{payments.length} {L("חיובים קבועים", "recurring charges")} · {plans.length} {L("עסקאות בתשלומים", "installment plans")}</span>
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">{L("בשנה (ללא תשלומים שמסתיימים)", "Per year (without ending installments)")}</span>
          <span className="kpi">{money(payments.reduce((a, s) => a + s.annualMinor, 0n), { whole: true })}</span>
        </div>
      </section>

      {next.length > 0 && (
        <section className="card stack">
          <h2>{L("צפוי ב-30 הימים הקרובים", "Expected in the next 30 days")}</h2>
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, "--gap": "10px" } as React.CSSProperties}>
            {next.map((s) => (
              <li key={s.key} className="row spread small">
                <span><span className="num">{date(s.nextDate)}</span> · {s.label}</span>
                <span className="num">{money(s.direction === "in" ? s.amountMinor : -s.amountMinor, { signed: true })}{s.confidence === "medium" ? <span className="muted"> · {L("משוער", "estimated")}</span> : null}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {payments.length > 0 && <section className="card stack" style={{ padding: "16px 4px" }}><h2 style={{ paddingInline: 12 }}>{L("חיובים קבועים", "Recurring charges")}</h2><Table rows={payments} /></section>}
      {plans.length > 0 && <section className="card stack" style={{ padding: "16px 4px" }}><h2 style={{ paddingInline: 12 }}>{L("עסקאות בתשלומים", "Installment plans")}</h2><Table rows={plans} showRemaining /></section>}
      {income.length > 0 && <section className="card stack" style={{ padding: "16px 4px" }}><h2 style={{ paddingInline: 12 }}>{L("הכנסות קבועות", "Recurring income")}</h2><Table rows={income} /></section>}
      {ended.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer" }}>{L("חיובים שהסתיימו", "Ended charges")} ({ended.length})</summary>
          <Table rows={ended} />
        </details>
      )}
      {series.length === 0 && <div className="card">{L("עוד לא זוהו חיובים קבועים. צריך לפחות שלושה חודשים של נתונים.", "No recurring charges found yet. At least three months of data are needed.")}</div>}
    </>
  );
}
