import Link from "next/link";
import { categoryBreakdown, dailySpending, merchantBreakdown, monthTotals } from "@ft/analytics";
import { ColumnChart, SERIES } from "@/components/charts";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { change, money, percent } from "@/lib/format";
import { periodHref, resolvePeriod } from "@/lib/period";

const TABS = [
  { id: "categories", label: "לפי קטגוריה" },
  { id: "merchants", label: "לפי בית עסק" },
  { id: "days", label: "לפי יום" },
] as const;

function Delta({ current, base }: { current: bigint; base: bigint | null }) {
  const d = change(current, base);
  return <span className={`num small ${d.dir === "up" ? "delta-up" : d.dir === "down" ? "delta-down" : "muted"}`}>{d.text}</span>;
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string; tab?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const tab = TABS.find((x) => x.id === params.tab)?.id ?? "categories";
  const data = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    return {
      period,
      totals: await monthTotals(tx, period.filters, period.month),
      categories: tab === "categories" ? await categoryBreakdown(tx, period.filters, period.month) : [],
      merchants: tab === "merchants" ? await merchantBreakdown(tx, period.filters, period.month, 30) : [],
      days: tab === "days" ? await dailySpending(tx, period.filters, period.month) : [],
    };
  });
  const { period, totals } = data;
  const tx = (q: Record<string, string>) => periodHref("/transactions", period, { side: "spending", ...q });

  return (
    <>
      <ScopeBar path="/expenses" period={period} title="הוצאות" />
      <section className="card row spread">
        <span>סה״כ הוצאות החודש</span>
        <span className="kpi">{money(totals.expensesMinor, { whole: true })}</span>
      </section>
      <nav className="tabs" aria-label="תצוגת הוצאות">
        {TABS.map((x) => (
          <Link key={x.id} href={periodHref("/expenses", period, { tab: x.id })} aria-current={tab === x.id ? "page" : undefined}>{x.label}</Link>
        ))}
      </nav>

      {tab === "categories" && (
        <section className="card" style={{ padding: "6px 4px" }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">קטגוריה</th><th scope="col">החודש</th><th scope="col">חלק</th><th scope="col">עסקאות</th>
                  <th scope="col">החודש הקודם</th><th scope="col">מול חודש קודם</th><th scope="col">ממוצע 3 חודשים</th><th scope="col">מול הממוצע</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((c) => (
                  <tr key={c.slug}>
                    <td><Link href={tx({ category: c.slug })}>{c.nameHe}</Link></td>
                    <td className="num">{money(c.minor, { whole: true })}</td>
                    <td className="num">{percent(c.share)}</td>
                    <td className="num">{c.count}</td>
                    <td className="num muted">{money(c.prevMinor, { whole: true })}</td>
                    <td><Delta current={c.minor} base={c.prevMinor} /></td>
                    <td className="num muted">{c.avg3Minor === null ? "—" : money(c.avg3Minor, { whole: true })}</td>
                    <td><Delta current={c.minor} base={c.avg3Minor} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "merchants" && (
        <section className="card" style={{ padding: "6px 4px" }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">בית עסק</th><th scope="col">החודש</th><th scope="col">עסקאות</th><th scope="col">ממוצע לעסקה</th><th scope="col">החודש הקודם</th><th scope="col">שינוי</th></tr>
              </thead>
              <tbody>
                {data.merchants.map((m) => (
                  <tr key={m.merchantId}>
                    <td><Link href={`/merchants/${m.merchantId}`}>{m.name}</Link></td>
                    <td className="num"><Link href={tx({ merchant: m.merchantId })} style={{ color: "inherit" }}>{money(m.minor, { whole: true })}</Link></td>
                    <td className="num">{m.count}</td>
                    <td className="num">{money(m.avgMinor)}</td>
                    <td className="num muted">{money(m.prevMinor, { whole: true })}</td>
                    <td><Delta current={m.minor} base={m.prevMinor} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "days" && (
        <section className="card stack">
          <h2>הוצאות לפי יום</h2>
          <ColumnChart
            title="הוצאות לפי יום בחודש"
            labels={data.days.map((d, i) => (i % 5 === 0 ? d.date.slice(8) : ""))}
            fullLabels={data.days.map((d) => `${d.date.slice(8)}.${d.date.slice(5, 7)}`)}
            series={[{ name: "הוצאות", color: SERIES.expenses, values: data.days.map((d) => d.minor) }]}
            colorBySign={[SERIES.expenses, SERIES.income]}
          />
          <p className="muted small" style={{ margin: 0 }}>ימים מתחת לאפס הם ימים שבהם התקבלו החזרים גדולים מההוצאות.</p>
        </section>
      )}
    </>
  );
}
