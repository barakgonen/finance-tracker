import { cashFlow } from "@ft/analytics";
import { ColumnChart, SERIES } from "@/components/charts";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { money, monthName } from "@/lib/format";
import { lastNMonths, resolvePeriod } from "@/lib/period";
import { L } from "@/lib/locale";

const ROWS = [
  { key: "incomeMinor", get label() { return L("הכנסות", "Income"); } },
  { key: "spendingMinor", get label() { return L("הוצאות", "Expenses"); } },
  { key: "netMinor", get label() { return L("תזרים נטו (הכנסות פחות הוצאות)", "Net cash flow (income minus expenses)"); }, strong: true },
  { key: "savedMinor", get label() { return L("הופקד לחיסכון והשקעות", "Put into savings and investments"); } },
  { key: "transfersMinor", get label() { return L("העברות (ביט, פייבוקס, בין חשבונות)", "Transfers (Bit, PayBox, between accounts)"); } },
  { key: "cardBillsMinor", get label() { return L("חיובי כרטיסי אשראי מהבנק (לא נספרים פעמיים)", "Credit card bills paid from the bank (not counted twice)"); } },
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
      <ScopeBar path="/cashflow" period={period} title={L("תזרים", "Cash flow")} />
      <section className="card stack">
        <h2>{L("תזרים נטו לפי חודש", "Net cash flow by month")}</h2>
        <ColumnChart
          title={L("תזרים נטו לפי חודש", "Net cash flow by month")}
          labels={months.map((m) => monthName(m.month, true))}
          fullLabels={months.map((m) => monthName(m.month))}
          series={[{ name: L("תזרים נטו", "Net cash flow"), color: SERIES.income, values: months.map((m) => m.netMinor) }]}
          colorBySign={[SERIES.income, SERIES.negative]}
        />
        <p className="muted small" style={{ margin: 0 }}>{L("מעל הקו: נשאר כסף בסוף החודש. מתחת לקו: יצא יותר משנכנס.", "Above the line: money left at the end of the month. Below: more went out than came in.")}</p>
      </section>
      <section className="card" style={{ padding: "6px 4px" }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{L("6 חודשים אחרונים", "Last 6 months")}</th>
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
                <th scope="row" style={{ fontWeight: 400, color: "inherit" }}>{L("חיסכון מצטבר בתקופה", "Total saved in the period")}</th>
                {savedToDate.map((v, i) => <td key={i} className="num muted">{money(v, { whole: true })}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
