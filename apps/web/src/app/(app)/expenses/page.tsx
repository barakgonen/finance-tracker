import Link from "next/link";
import { categoryBreakdown, dailySpending, merchantBreakdown, monthTotals } from "@ft/analytics";
import { ColumnChart, SERIES } from "@/components/charts";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { change, money, percent } from "@/lib/format";
import { periodHref, resolvePeriod } from "@/lib/period";
import { L, categoryName } from "@/lib/locale";

const TABS = [
  { id: "categories", get label() { return L("לפי קטגוריה", "By category"); } },
  { id: "merchants", get label() { return L("לפי בית עסק", "By merchant"); } },
  { id: "days", get label() { return L("לפי יום", "By day"); } },
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
      <ScopeBar path="/expenses" period={period} title={L("הוצאות", "Expenses")} />
      <section className="card row spread">
        <span>{L("סה״כ הוצאות החודש", "Total expenses this month")}</span>
        <span className="kpi">{money(totals.expensesMinor, { whole: true })}</span>
      </section>
      <nav className="tabs" aria-label={L("תצוגת הוצאות", "Expenses view")}>
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
                  <th scope="col">{L("קטגוריה", "Category")}</th><th scope="col">{L("החודש", "This month")}</th><th scope="col">{L("חלק", "Share")}</th><th scope="col">{L("עסקאות", "Purchases")}</th>
                  <th scope="col">{L("החודש הקודם", "Last month")}</th><th scope="col">{L("מול חודש קודם", "vs. last month")}</th><th scope="col">{L("ממוצע 3 חודשים", "3-month average")}</th><th scope="col">{L("מול הממוצע", "vs. average")}</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((c) => (
                  <tr key={c.slug}>
                    <td><Link href={tx({ category: c.slug })}>{categoryName(c.nameHe)}</Link></td>
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
                <tr><th scope="col">{L("בית עסק", "Merchant")}</th><th scope="col">{L("החודש", "This month")}</th><th scope="col">{L("עסקאות", "Purchases")}</th><th scope="col">{L("ממוצע לעסקה", "Average purchase")}</th><th scope="col">{L("החודש הקודם", "Last month")}</th><th scope="col">{L("שינוי", "Change")}</th></tr>
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
          <h2>{L("הוצאות לפי יום", "Spending by day")}</h2>
          <ColumnChart
            title={L("הוצאות לפי יום בחודש", "Spending by day of the month")}
            labels={data.days.map((d) => d.date.slice(8))}
            fullLabels={data.days.map((d) => `${d.date.slice(8)}.${d.date.slice(5, 7)}`)}
            series={[{ name: L("הוצאות", "Expenses"), color: SERIES.expenses, values: data.days.map((d) => d.minor) }]}
            colorBySign={[SERIES.expenses, SERIES.income]}
          />
          <p className="muted small" style={{ margin: 0 }}>{L("ימים מתחת לאפס הם ימים שבהם התקבלו החזרים גדולים מההוצאות.", "Days below zero are days when refunds were larger than spending.")}</p>
        </section>
      )}
    </>
  );
}
