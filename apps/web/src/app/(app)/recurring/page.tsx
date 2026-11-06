import Link from "next/link";
import { recurringSeries, upcoming, type RecurringWithCategory } from "@ft/analytics";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { date, money } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";

const CADENCE = { weekly: "שבועי", monthly: "חודשי", bimonthly: "דו-חודשי", yearly: "שנתי" } as const;

function Table({ rows, showRemaining }: { rows: RecurringWithCategory[]; showRemaining?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">שם</th><th scope="col">תדירות</th><th scope="col">סכום</th><th scope="col">בחודש</th>
            {showRemaining ? <th scope="col">נותרו</th> : <th scope="col">בשנה</th>}
            <th scope="col">החיוב הבא</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.key}>
              <td>
                {s.merchantId ? <Link href={`/merchants/${s.merchantId}`}>{s.label}</Link> : s.label}
                {s.categoryName ? <span className="muted small"> · {s.categoryName}</span> : null}
                {s.previousTypicalMinor !== null && s.lastAmountMinor > s.previousTypicalMinor ? <span className="chip warn" style={{ marginInlineStart: 8 }}>התייקר</span> : null}
              </td>
              <td className="small">{CADENCE[s.cadence]}{s.confidence === "medium" ? <span className="muted"> · משוער</span> : null}</td>
              <td className="num">{money(s.amountMinor)}{s.amountVariation > 0.05 ? <span className="muted small"> (משתנה)</span> : null}</td>
              <td className="num">{money(s.monthlyMinor, { whole: true })}</td>
              {showRemaining ? (
                <td className="num">{s.installments!.remaining} מתוך {s.installments!.total}</td>
              ) : (
                <td className="num">{money(s.annualMinor, { whole: true })}</td>
              )}
              <td className="num">{s.active ? date(s.nextDate) : <span className="muted">הסתיים</span>}</td>
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
      <ScopeBar path="/recurring" period={period} title="חיובים קבועים" />
      <p className="muted small" style={{ margin: 0 }}>
        חיוב נחשב קבוע אחרי לפחות 3 פעמים במרווח קבוע ובסכום דומה. עסקאות בתשלומים מזוהות מהדוח עצמו.
      </p>
      <section className="grid">
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">חיובים קבועים בחודש</span>
          <span className="kpi">{money(monthly, { whole: true })}</span>
          <span className="small muted">{payments.length} חיובים קבועים · {plans.length} עסקאות בתשלומים</span>
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">בשנה (ללא תשלומים שמסתיימים)</span>
          <span className="kpi">{money(payments.reduce((a, s) => a + s.annualMinor, 0n), { whole: true })}</span>
        </div>
      </section>

      {next.length > 0 && (
        <section className="card stack">
          <h2>צפוי ב-30 הימים הקרובים</h2>
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, "--gap": "10px" } as React.CSSProperties}>
            {next.map((s) => (
              <li key={s.key} className="row spread small">
                <span><span className="num">{date(s.nextDate)}</span> · {s.label}</span>
                <span className="num">{money(s.direction === "in" ? s.amountMinor : -s.amountMinor, { signed: true })}{s.confidence === "medium" ? <span className="muted"> · משוער</span> : null}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {payments.length > 0 && <section className="card stack" style={{ padding: "16px 4px" }}><h2 style={{ paddingInline: 12 }}>חיובים קבועים</h2><Table rows={payments} /></section>}
      {plans.length > 0 && <section className="card stack" style={{ padding: "16px 4px" }}><h2 style={{ paddingInline: 12 }}>עסקאות בתשלומים</h2><Table rows={plans} showRemaining /></section>}
      {income.length > 0 && <section className="card stack" style={{ padding: "16px 4px" }}><h2 style={{ paddingInline: 12 }}>הכנסות קבועות</h2><Table rows={income} /></section>}
      {ended.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer" }}>חיובים שהסתיימו ({ended.length})</summary>
          <Table rows={ended} />
        </details>
      )}
      {series.length === 0 && <div className="card">עוד לא זוהו חיובים קבועים. צריך לפחות שלושה חודשים של נתונים.</div>}
    </>
  );
}
