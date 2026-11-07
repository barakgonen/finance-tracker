import Link from "next/link";
import { budgetsWithStatus, categoryBreakdown, healthScore, largestTransactions, merchantBreakdown, monthlySeries, openInsights, recurringSeries, upcoming } from "@ft/analytics";
import { InsightCard } from "@/components/InsightCard";
import { insightStateAction } from "./insights/actions";
import { describeInsight } from "@/lib/insight-text";
import { BUDGET_STATE } from "@/lib/planning-text";
import { BarList, ColumnChart, SERIES } from "@/components/charts";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { change, date, money, monthName, percent } from "@/lib/format";
import { messages } from "@/lib/i18n";
import { lastNMonths, periodHref, resolvePeriod } from "@/lib/period";
import { reviewCount } from "@/lib/queries";

function Kpi({ label, value, swatch, delta, upIsGood }: { label: string; value: string; swatch?: string; delta?: { text: string; dir: string }; upIsGood?: boolean }) {
  const tone = !delta || delta.dir === "none" || delta.dir === "flat" ? "muted" : (delta.dir === "up") === upIsGood ? "delta-down" : "delta-up";
  return (
    <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
      <span className="muted small row" style={{ "--gap": "6px" } as React.CSSProperties}>
        {swatch && <span className="swatch" style={{ background: swatch }} aria-hidden="true" />}
        {label}
      </span>
      <span className="kpi">{value}</span>
      {delta && <span className={`small ${tone}`}>{delta.text} <span className="muted">מהחודש הקודם</span></span>}
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ month?: string; view?: string }> }) {
  const viewer = await requireViewer();
  const t = messages(viewer.locale);
  const params = await searchParams;
  const data = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    const { first, last } = lastNMonths(period.month, 12);
    const series = await monthlySeries(tx, period.filters, first, last);
    return {
      period,
      series,
      categories: await categoryBreakdown(tx, period.filters, period.month),
      merchants: await merchantBreakdown(tx, period.filters, period.month, 5),
      largest: await largestTransactions(tx, period.filters, period.month, 5),
      pending: await reviewCount(tx, viewer.householdId, viewer.memberId),
      insights: (await openInsights(tx, period.filters, period.month)).open,
      recurring: await recurringSeries(tx, period.filters, period.month),
      health: await healthScore(tx, period.filters, period.month),
      budgets: await budgetsWithStatus(tx, period.filters, period.month),
    };
  });
  const { period, series, categories, merchants, largest, pending, insights, recurring, health, budgets } = data;
  const alerts = budgets.filter((b) => b.status.state !== "ok");
  const today = new Date().toISOString().slice(0, 10);
  const soon = upcoming(recurring, `${period.month}-28` < today ? `${period.month}-28` : today, 14).filter((s) => s.direction === "out");
  const cur = series[series.length - 1]!;
  const prev = series[series.length - 2]!;
  const rate = cur.incomeMinor > 0n ? Number(cur.netMinor) / Number(cur.incomeMinor) : null;
  const prevRate = prev.incomeMinor > 0n ? Number(prev.netMinor) / Number(prev.incomeMinor) : null;
  const hasHistory = series.some((m) => m.transactionCount > 0);
  const firstWithData = series.findIndex((m) => m.transactionCount > 0);
  const shown = series.slice(Math.max(0, Math.min(firstWithData, series.length - 6)));
  const tx = (q: Record<string, string>) => periodHref("/transactions", period, q);

  return (
    <>
      <ScopeBar path="/" period={period} title={t.nav.dashboard} />
      {cur.transactionCount === 0 ? (
        <div className="card">
          {t.dashboard.empty} <Link href="/import">{t.nav.import}</Link>
        </div>
      ) : (
        <>
          {cur.unreviewedCount > 0 && (
            <div role="note" className="banner warn">
              <span>
                {t.dashboard.unreviewedNote
                  .replace("{count}", String(cur.unreviewedCount))
                  .replace("{income}", money(cur.unreviewedIncomeMinor, { whole: true }))
                  .replace("{expenses}", money(cur.unreviewedExpensesMinor, { whole: true }))}{" "}
                <Link href="/review">{t.dashboard.toReview}</Link>
              </span>
            </div>
          )}
          <section className="grid" aria-label="סיכום החודש">
            <Kpi label={t.dashboard.income} swatch={SERIES.income} value={money(cur.incomeMinor, { whole: true })} delta={change(cur.incomeMinor, prev.transactionCount ? prev.incomeMinor : null)} upIsGood />
            <Kpi label={t.dashboard.expenses} swatch={SERIES.expenses} value={money(cur.expensesMinor, { whole: true })} delta={change(cur.expensesMinor, prev.transactionCount ? prev.expensesMinor : null)} upIsGood={false} />
            <Kpi label={t.dashboard.net} value={money(cur.netMinor, { whole: true, signed: true })} />
            <Kpi
              label={t.dashboard.savingsRate}
              value={rate === null ? "—" : percent(rate)}
              delta={rate !== null && prevRate !== null ? { text: `${rate >= prevRate ? "▲" : "▼"} ${Math.abs(Math.round((rate - prevRate) * 100))} נק׳`, dir: rate >= prevRate ? "up" : "down" } : undefined}
              upIsGood
            />
            <Link href={periodHref("/health", period)} className="card stack" style={{ "--gap": "6px", textDecoration: "none", color: "inherit" } as React.CSSProperties}>
              <span className="muted small">בריאות פיננסית</span>
              <span className="kpi">{health.total === null ? "—" : <>{health.total}<span className="muted small"> / 100</span></>}</span>
              <span className="small" style={{ color: "var(--accent)" }}>{health.total === null ? "אין עדיין מספיק נתונים" : "איך זה מחושב?"}</span>
            </Link>
          </section>

          {insights.length > 0 && (
            <section className="stack" aria-labelledby="ins-h">
              <div className="row spread">
                <h2 id="ins-h">מה כדאי לדעת החודש</h2>
                <Link className="small" href={periodHref("/insights", period)}>כל התובנות ({insights.length})</Link>
              </div>
              <div className="grid">
                {insights.slice(0, 3).map((i) => (
                  <InsightCard key={i.id} view={describeInsight(i, period)} actions={viewer.role !== "viewer" ? { action: insightStateAction, insightId: i.id, returnTo: periodHref("/", period) } : undefined} />
                ))}
              </div>
            </section>
          )}

          {hasHistory && (
            <section className="card stack">
              <div className="row spread">
                <h2>הכנסות מול הוצאות</h2>
                <Link className="small" href={periodHref("/cashflow", period)}>תזרים מלא</Link>
              </div>
              <ColumnChart
                title="הכנסות והוצאות לפי חודש"
                labels={shown.map((m) => monthName(m.month, true))}
                fullLabels={shown.map((m) => monthName(m.month))}
                series={[
                  { name: t.dashboard.income, color: SERIES.income, values: shown.map((m) => m.incomeMinor) },
                  { name: t.dashboard.expenses, color: SERIES.expenses, values: shown.map((m) => m.expensesMinor) },
                ]}
              />
            </section>
          )}

          <div className="row" style={{ alignItems: "stretch" }}>
            <section className="card stack" style={{ flex: "3 1 420px" }}>
              <div className="row spread">
                <h2>{t.dashboard.byCategory}</h2>
                <Link className="small" href={periodHref("/expenses", period)}>פירוט מלא</Link>
              </div>
              <BarList
                color={SERIES.expenses}
                valueName="החודש"
                referenceName="ממוצע 3 חודשים קודמים"
                rows={categories.filter((c) => c.minor > 0n).slice(0, 8).map((c) => ({
                  key: c.slug,
                  label: c.nameHe,
                  href: tx({ side: "spending", category: c.slug }),
                  value: c.minor,
                  reference: c.avg3Minor,
                  note: percent(c.share),
                  muted: c.slug === "card_unitemized" || c.slug === "uncategorized",
                }))}
              />
            </section>
            <div className="stack" style={{ flex: "2 1 300px" }}>
              <section className="card stack">
                <h2>בתי עסק מובילים</h2>
                <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, "--gap": "10px" } as React.CSSProperties}>
                  {merchants.map((m) => (
                    <li key={m.merchantId} className="row spread small">
                      <Link href={`/merchants/${m.merchantId}`}>{m.name}</Link>
                      <Link href={tx({ side: "spending", merchant: m.merchantId })} className="num" style={{ color: "inherit" }}>{money(m.minor, { whole: true })} <span className="muted">· {m.count} עסקאות</span></Link>
                    </li>
                  ))}
                </ul>
              </section>
              {alerts.length > 0 && (
                <section className="card stack">
                  <div className="row spread">
                    <h2>תקציבים שדורשים תשומת לב</h2>
                    <Link className="small" href={periodHref("/budgets", period)}>כל התקציבים</Link>
                  </div>
                  <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, "--gap": "10px" } as React.CSSProperties}>
                    {alerts.map((b) => (
                      <li key={b.id} className="row spread small">
                        <span>{b.categoryName} <span className={`chip ${BUDGET_STATE[b.status.state].tone}`}>{BUDGET_STATE[b.status.state].icon} {BUDGET_STATE[b.status.state].label}</span></span>
                        <span className="num">{money(b.status.spentMinor, { whole: true })} / {money(b.status.limitMinor, { whole: true })}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {soon.length > 0 && (
                <section className="card stack">
                  <div className="row spread">
                    <h2>חיובים צפויים · 14 יום</h2>
                    <Link className="small" href={periodHref("/recurring", period)}>הכל</Link>
                  </div>
                  <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, "--gap": "10px" } as React.CSSProperties}>
                    {soon.map((s) => (
                      <li key={s.key} className="row spread small">
                        <span>{s.label} <span className="muted">· <span className="num">{date(s.nextDate)}</span></span></span>
                        <span className="num">{s.confidence === "medium" ? "~" : ""}{money(s.amountMinor, { whole: true })}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <Link href="/review" className="card stack" style={{ textDecoration: "none", color: "inherit" }}>
                <h2>{t.dashboard.review}</h2>
                <span className="kpi">{pending}</span>
                <span style={{ color: "var(--accent)", fontWeight: 500 }}>{t.dashboard.toReview}</span>
              </Link>
            </div>
          </div>

          <section className="card stack">
            <h2>התנועות הגדולות החודש</h2>
            <div className="table-wrap">
              <table>
                <tbody>
                  {largest.map((l) => (
                    <tr key={l.id}>
                      <td className="num">{date(l.purchaseDate)}</td>
                      <td>{l.description}{l.needsReview ? <span className="chip warn" style={{ marginInlineStart: 8 }}>לבדיקה</span> : null}</td>
                      <td className="muted small">{t.kinds[l.kind]}</td>
                      <td className="num" style={{ textAlign: "end" }}>{money(l.amount, { signed: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
