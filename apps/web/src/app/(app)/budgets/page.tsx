import Link from "next/link";
import { budgetSuggestions, budgetsWithStatus } from "@ft/analytics";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { money, percent } from "@/lib/format";
import { periodHref, resolvePeriod } from "@/lib/period";
import { BUDGET_STATE } from "@/lib/planning-text";
import { categories } from "@/lib/queries";
import { deleteBudgetAction, setBudgetAction } from "./actions";

const ERRORS: Record<string, string> = { limit: "יש להזין סכום חיובי" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string; error?: string; saved?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const data = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    return {
      period,
      budgets: await budgetsWithStatus(tx, period.filters, period.month),
      suggestions: await budgetSuggestions(tx, period.filters, period.month),
      cats: (await categories(tx, viewer.householdId)).filter((c) => c.type === "expense" && c.slug !== "card_unitemized"),
    };
  });
  const { period, budgets, suggestions, cats } = data;
  const canEdit = viewer.role !== "viewer";
  const budgeted = new Set(budgets.map((b) => b.categorySlug));
  const hidden = (
    <>
      <input type="hidden" name="month" value={period.month} />
      {period.view && <input type="hidden" name="view" value={period.view} />}
    </>
  );
  const owner = period.view ? period.people.find((p) => p.id === period.view)?.displayName : "משק הבית";

  return (
    <>
      <ScopeBar path="/budgets" period={period} title={`תקציבים · ${owner}`} />
      {params.error && <div role="alert" className="banner warn">{ERRORS[params.error] ?? params.error}</div>}
      {params.saved && <div role="status" className="banner ok">נשמר</div>}

      {budgets.length === 0 ? (
        <div className="card">עוד לא הוגדרו תקציבים{period.view ? " אישיים" : ""}. אפשר להתחיל מההצעות למטה, שמבוססות על ההוצאה בפועל ב-3 החודשים האחרונים.</div>
      ) : (
        <section className="card stack">
          <h2>החודש</h2>
          <ul className="barlist">
            {budgets.map((b) => {
              const s = BUDGET_STATE[b.status.state];
              const tip = `${b.categoryName}\n${money(b.status.spentMinor, { whole: true })} מתוך ${money(b.status.limitMinor, { whole: true })}\nצפי לסוף החודש: ${money(b.status.projectedMinor, { whole: true })}`;
              return (
                <li key={b.id} data-tip={tip} tabIndex={0} aria-label={tip.replace(/\n/g, ", ")}>
                  <div className="row spread small">
                    <span>
                      <Link href={periodHref("/transactions", period, { side: "spending", category: b.categorySlug })}>{b.categoryName}</Link>{" "}
                      <span className={`chip ${s.tone}`}>{s.icon} {s.label}</span>
                    </span>
                    <span className="num">
                      {money(b.status.spentMinor, { whole: true })} / {money(b.status.limitMinor, { whole: true })}
                      <span className="muted"> · {percent(b.status.ratio)}</span>
                    </span>
                  </div>
                  <div className="bar-track" aria-hidden="true">
                    <span className="bar-fill" style={{ inlineSize: `${Math.min(100, b.status.ratio * 100)}%`, background: b.status.state === "over" || b.status.state === "near" ? "var(--expense)" : "var(--accent)" }} />
                    <span className="bar-ref" style={{ insetInlineStart: `${b.alertRatio * 100}%` }} />
                  </div>
                  <div className="row spread small muted">
                    <span>{b.status.projectedMinor !== b.status.spentMinor ? `בקצב הנוכחי: כ-${money(b.status.projectedMinor, { whole: true })} עד סוף החודש` : ""}</span>
                    {canEdit && (
                      <form action={deleteBudgetAction}>
                        {hidden}
                        <input type="hidden" name="budgetId" value={b.id} />
                        <button className="btn" type="submit" style={{ minBlockSize: 32, padding: "4px 10px", fontSize: 12 }}>הסרה</button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="muted small" style={{ margin: 0 }}>הקו על כל פס הוא סף ההתראה. ״בקצב לחריגה״ נבדק מהשבוע השני של החודש.</p>
        </section>
      )}

      {canEdit && (
        <>
          {suggestions.filter((s) => !budgeted.has(s.slug)).length > 0 && (
            <section className="card stack">
              <h2>הצעות לפי 3 החודשים האחרונים</h2>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {suggestions.filter((s) => !budgeted.has(s.slug)).slice(0, 8).map((s) => (
                      <tr key={s.slug}>
                        <td>{s.name}</td>
                        <td className="num">{money(s.suggestedMinor!, { whole: true })} לחודש</td>
                        <td style={{ textAlign: "end" }}>
                          <form action={setBudgetAction}>
                            {hidden}
                            <input type="hidden" name="category" value={s.slug} />
                            <input type="hidden" name="limit" value={(Number(s.suggestedMinor) / 100).toFixed(0)} />
                            <button className="btn" type="submit">הגדרה</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <form action={setBudgetAction} className="card stack">
            <h2>תקציב חדש או עדכון</h2>
            {hidden}
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field-group" style={{ flex: "2 1 200px" }}>
                <label htmlFor="category">קטגוריה</label>
                <select className="field" id="category" name="category" required defaultValue="">
                  <option value="" disabled>בחירה…</option>
                  {cats.map((c) => <option key={c.id} value={c.slug}>{c.nameHe}</option>)}
                </select>
              </div>
              <div className="field-group" style={{ flex: "1 1 140px" }}>
                <label htmlFor="limit">סכום לחודש (₪)</label>
                <input className="field num" id="limit" name="limit" inputMode="decimal" required dir="ltr" />
              </div>
              <div className="field-group" style={{ flex: "1 1 120px" }}>
                <label htmlFor="alert">התראה ב-(%)</label>
                <input className="field num" id="alert" name="alert" type="number" min={10} max={100} defaultValue={80} dir="ltr" />
              </div>
              <button className="btn primary" type="submit">שמירה</button>
            </div>
          </form>
        </>
      )}
    </>
  );
}
