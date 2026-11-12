import Link from "next/link";
import { categoryBreakdown, incomeStability, monthlySeries } from "@ft/analytics";
import { ColumnChart, SERIES } from "@/components/charts";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { change, money, monthName, percent } from "@/lib/format";
import { lastNMonths, periodHref, resolvePeriod } from "@/lib/period";
import { L, categoryName } from "@/lib/locale";

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
      <ScopeBar path="/income" period={period} title={L("הכנסות", "Income")} />
      <section className="grid">
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">{L("הכנסות החודש", "Income this month")}</span>
          <span className="kpi">{money(cur.incomeMinor, { whole: true })}</span>
          {avg !== null && <span className="small muted">{change(cur.incomeMinor, avg).text} {L("מול הממוצע החודשי", "vs. the monthly average")}</span>}
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">{L("ממוצע חודשי", "Monthly average")} ({withData.length} {L("חודשים עם הכנסה", "months with income")})</span>
          <span className="kpi">{avg === null ? "—" : money(avg, { whole: true })}</span>
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">{L("יציבות ההכנסה", "Income stability")}</span>
          <span className="kpi">{stability === null ? "—" : stability < 0.1 ? L("יציבה", "Stable") : stability < 0.25 ? L("משתנה מעט", "Varies a little") : L("משתנה", "Varies")}</span>
          <span className="small muted">
            {stability === null ? L("נדרשים לפחות 3 חודשים עם הכנסה", "Needs at least 3 months with income") : L(`סטייה ממוצעת של ${percent(stability)} מהממוצע`, `Deviates ${percent(stability)} from the average, on average`)}
          </span>
        </div>
      </section>

      <section className="card stack">
        <h2>{L("הכנסות לפי חודש", "Income by month")}</h2>
        <ColumnChart
          title={L("הכנסות לפי חודש", "Income by month")}
          labels={shown.map((m) => monthName(m.month, true))}
          fullLabels={shown.map((m) => monthName(m.month))}
          series={[{ name: L("הכנסות", "Income"), color: SERIES.income, values: shown.map((m) => m.incomeMinor) }]}
        />
      </section>

      <section className="card stack">
        <h2>{L("מקורות הכנסה החודש", "Income sources this month")}</h2>
        {sources.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{L("אין הכנסות מסווגות בחודש הזה.", "No categorized income this month.")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">{L("מקור", "Source")}</th><th scope="col">{L("החודש", "This month")}</th><th scope="col">{L("חלק", "Share")}</th><th scope="col">{L("החודש הקודם", "Last month")}</th><th scope="col">{L("ממוצע 3 חודשים", "3-month average")}</th></tr>
              </thead>
              <tbody>
                {sources.map((c) => (
                  <tr key={c.slug}>
                    <td><Link href={periodHref("/transactions", period, { side: "income", category: c.slug })}>{categoryName(c.nameHe)}</Link></td>
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
