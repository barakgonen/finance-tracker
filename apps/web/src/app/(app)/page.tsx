import Link from "next/link";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { money, percent } from "@/lib/format";
import { messages } from "@/lib/i18n";
import { latestMonth, members, monthSummary, reviewCount } from "@/lib/queries";

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function shift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ month?: string; view?: string }> }) {
  const viewer = await requireViewer();
  const t = messages(viewer.locale);
  const params = await searchParams;
  const { month, people, view, summary, pending } = await scope(householdScope(viewer), async (tx) => {
    const month = /^\d{4}-\d{2}$/.test(params.month ?? "") ? params.month! : await latestMonth(tx, viewer.householdId);
    const people = await members(tx, viewer.householdId);
    const view = people.find((p) => p.id === params.view)?.id;
    const summary = await monthSummary(tx, viewer.householdId, month, view);
    const pending = await reviewCount(tx, viewer.householdId);
    return { month, people, view, summary, pending };
  });
  const [y, m] = month.split("-").map(Number) as [number, number];
  const rate = summary.incomeMinor > 0n ? Number(summary.netMinor) / Number(summary.incomeMinor) : null;
  const maxCat = summary.categories[0]?.minor ?? 1n;
  const link = (q: { month?: string; view?: string }) =>
    `/?${new URLSearchParams({ month: q.month ?? month, ...(q.view ?? view ? { view: (q.view ?? view)! } : {}) })}`;

  return (
    <>
      <header className="row spread">
        <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
          <Link className="btn" href={link({ month: shift(month, -1) })} aria-label={t.dashboard.prev}>→</Link>
          <h1>{MONTHS[m - 1]} {y}</h1>
          <Link className="btn" href={link({ month: shift(month, 1) })} aria-label={t.dashboard.next}>←</Link>
        </div>
        <div className="seg" role="group">
          <Link href={`/?month=${month}`} aria-current={!view}>{t.dashboard.household}</Link>
          {people.map((p) => (
            <Link key={p.id} href={`/?month=${month}&view=${p.id}`} aria-current={view === p.id}>{p.displayName}</Link>
          ))}
        </div>
      </header>

      {summary.transactionCount === 0 ? (
        <div className="card">
          {t.dashboard.empty} <Link href="/import">{t.nav.import}</Link>
        </div>
      ) : (
        <>
          {summary.unreviewed.count > 0 && (
            <div role="note" className="banner warn">
              <span>
                {t.dashboard.unreviewedNote
                  .replace("{count}", String(summary.unreviewed.count))
                  .replace("{income}", money(summary.unreviewed.incomeMinor, { whole: true }))
                  .replace("{expenses}", money(summary.unreviewed.expensesMinor, { whole: true }))}{" "}
                <Link href="/review">{t.dashboard.toReview}</Link>
              </span>
            </div>
          )}
          <section className="grid" aria-label={t.dashboard.net}>
            <div className="card stack" style={{ "--gap": "8px" } as React.CSSProperties}>
              <span className="muted small">{t.dashboard.income}</span>
              <span className="kpi num" style={{ color: "var(--income)" }}>{money(summary.incomeMinor, { whole: true })}</span>
            </div>
            <div className="card stack" style={{ "--gap": "8px" } as React.CSSProperties}>
              <span className="muted small">{t.dashboard.expenses}</span>
              <span className="kpi num" style={{ color: "var(--expense)" }}>{money(summary.expensesMinor, { whole: true })}</span>
            </div>
            <div className="card stack" style={{ "--gap": "8px" } as React.CSSProperties}>
              <span className="muted small">{t.dashboard.net}</span>
              <span className="kpi num">{money(summary.netMinor, { whole: true, signed: true })}</span>
            </div>
            <div className="card stack" style={{ "--gap": "8px" } as React.CSSProperties}>
              <span className="muted small">{t.dashboard.savingsRate}</span>
              <span className="kpi num">{rate === null ? t.dashboard.noIncome : percent(rate)}</span>
            </div>
          </section>

          <div className="row" style={{ alignItems: "stretch" }}>
            <section className="card stack" style={{ flex: "2 1 420px" }}>
              <h2>{t.dashboard.byCategory}</h2>
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, "--gap": "12px" } as React.CSSProperties}>
                {summary.categories.map((c) => (
                  <li key={c.slug} className="stack" style={{ "--gap": "6px" } as React.CSSProperties}>
                    <div className="row spread small">
                      <span>{c.nameHe}</span>
                      <span className="num">{money(c.minor, { whole: true })}</span>
                    </div>
                    <div className="bar" aria-hidden="true">
                      <span style={{ inlineSize: `${(Number(c.minor) / Number(maxCat)) * 100}%`, background: c.slug === "card_unitemized" ? "#a7aeb8" : undefined }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <Link href="/review" className="card stack" style={{ flex: "1 1 220px", textDecoration: "none", color: "inherit" }}>
              <h2>{t.dashboard.review}</h2>
              <span className="kpi num">{pending}</span>
              <span style={{ color: "var(--accent)", fontWeight: 500, marginBlockStart: "auto" }}>{t.dashboard.toReview}</span>
            </Link>
          </div>
        </>
      )}
    </>
  );
}
