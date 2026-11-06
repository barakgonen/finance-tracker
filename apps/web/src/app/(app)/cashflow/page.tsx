import { cashFlow } from "@ft/analytics";
import { ColumnChart, SERIES } from "@/components/charts";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { money, monthName } from "@/lib/format";
import { lastNMonths, resolvePeriod } from "@/lib/period";

const ROWS = [
  { key: "incomeMinor", label: "הכנסות" },
  { key: "spendingMinor", label: "הוצאות" },
  { key: "netMinor", label: "תזרים נטו (הכנסות פחות הוצאות)", strong: true },
  { key: "savedMinor", label: "הופקד לחיסכון והשקעות" },
  { key: "transfersMinor", label: "העברות (ביט, פייבוקס, בין חשבונות)" },
  { key: "cardBillsMinor", label: "חיובי כרטיסי אשראי מהבנק (לא נספרים פעמיים)" },
] as const;

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const { period, months } = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    const { first, last } = lastNMonths(period.month, 6);
    return { period, months: await cashFlow(tx, period.filters, first, last) };
  });
  let cumulative = 0n;
  const savedToDate = months.map((m) => (cumulative += m.savedMinor));

  return (
    <>
      <ScopeBar path="/cashflow" period={period} title="תזרים" />
      <section className="card stack">
        <h2>תזרים נטו לפי חודש</h2>
        <ColumnChart
          title="תזרים נטו לפי חודש"
          labels={months.map((m) => monthName(m.month, true))}
          fullLabels={months.map((m) => monthName(m.month))}
          series={[{ name: "תזרים נטו", color: SERIES.income, values: months.map((m) => m.netMinor) }]}
          colorBySign={[SERIES.income, SERIES.negative]}
        />
        <p className="muted small" style={{ margin: 0 }}>מעל הקו: נשאר כסף בסוף החודש. מתחת לקו: יצא יותר משנכנס.</p>
      </section>
      <section className="card" style={{ padding: "6px 4px" }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">6 חודשים אחרונים</th>
                {months.map((m) => <th key={m.month} scope="col">{monthName(m.month, true)}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key}>
                  <th scope="row" style={{ fontWeight: "strong" in r ? 600 : 400, color: "inherit", whiteSpace: "normal" }}>{r.label}</th>
                  {months.map((m) => (
                    <td key={m.month} className="num" style={{ fontWeight: "strong" in r ? 600 : 400 }}>
                      {money(m[r.key], { whole: true, signed: r.key === "netMinor" || r.key === "transfersMinor" })}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" style={{ fontWeight: 400, color: "inherit" }}>חיסכון מצטבר בתקופה</th>
                {savedToDate.map((v, i) => <td key={i} className="num muted">{money(v, { whole: true })}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
