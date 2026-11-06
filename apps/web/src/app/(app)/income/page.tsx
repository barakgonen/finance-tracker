import Link from "next/link";
import { categoryBreakdown, incomeStability, monthlySeries } from "@ft/analytics";
import { ColumnChart, SERIES } from "@/components/charts";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { change, money, monthName, percent } from "@/lib/format";
import { lastNMonths, periodHref, resolvePeriod } from "@/lib/period";

export default async function IncomePage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const data = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    const { first, last } = lastNMonths(period.month, 12);
    return {
      period,
      series: await monthlySeries(tx, period.filters, first, last),
      sources: await categoryBreakdown(tx, period.filters, period.month, "income"),
    };
  });
  const { period, series, sources } = data;
  const cur = series[series.length - 1]!;
  const withData = series.filter((m) => m.incomeMinor > 0n);
  const stability = incomeStability(series.map((m) => m.incomeMinor));
  const avg = withData.length ? withData.reduce((a, m) => a + m.incomeMinor, 0n) / BigInt(withData.length) : null;
  const firstWithData = series.findIndex((m) => m.transactionCount > 0);
  const shown = series.slice(Math.max(0, Math.min(firstWithData, series.length - 6)));

  return (
    <>
      <ScopeBar path="/income" period={period} title="הכנסות" />
      <section className="grid">
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">הכנסות החודש</span>
          <span className="kpi">{money(cur.incomeMinor, { whole: true })}</span>
          {avg !== null && <span className="small muted">{change(cur.incomeMinor, avg).text} מול הממוצע החודשי</span>}
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">ממוצע חודשי ({withData.length} חודשים עם הכנסה)</span>
          <span className="kpi">{avg === null ? "—" : money(avg, { whole: true })}</span>
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">יציבות ההכנסה</span>
          <span className="kpi">{stability === null ? "—" : stability < 0.1 ? "יציבה" : stability < 0.25 ? "משתנה מעט" : "משתנה"}</span>
          <span className="small muted">
            {stability === null ? "נדרשים לפחות 3 חודשים עם הכנסה" : `סטייה ממוצעת של ${percent(stability)} מהממוצע`}
          </span>
        </div>
      </section>

      <section className="card stack">
        <h2>הכנסות לפי חודש</h2>
        <ColumnChart
          title="הכנסות לפי חודש"
          labels={shown.map((m) => monthName(m.month, true))}
          fullLabels={shown.map((m) => monthName(m.month))}
          series={[{ name: "הכנסות", color: SERIES.income, values: shown.map((m) => m.incomeMinor) }]}
        />
      </section>

      <section className="card stack">
        <h2>מקורות הכנסה החודש</h2>
        {sources.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>אין הכנסות מסווגות בחודש הזה.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">מקור</th><th scope="col">החודש</th><th scope="col">חלק</th><th scope="col">החודש הקודם</th><th scope="col">ממוצע 3 חודשים</th></tr>
              </thead>
              <tbody>
                {sources.map((c) => (
                  <tr key={c.slug}>
                    <td><Link href={periodHref("/transactions", period, { side: "income", category: c.slug })}>{c.nameHe}</Link></td>
                    <td className="num">{money(c.minor, { whole: true })}</td>
                    <td className="num">{percent(c.share)}</td>
                    <td className="num muted">{money(c.prevMinor, { whole: true })}</td>
                    <td className="num muted">{c.avg3Minor === null ? "—" : money(c.avg3Minor, { whole: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
