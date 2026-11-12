import Link from "next/link";
import { budgetSuggestions, budgetsWithStatus } from "@ft/analytics";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { hebrewError } from "@/lib/errors";
import { money, percent } from "@/lib/format";
import { periodHref, resolvePeriod } from "@/lib/period";
import { BUDGET_STATE } from "@/lib/planning-text";
import { categories } from "@/lib/queries";
import { deleteBudgetAction, setBudgetAction } from "./actions";
import { L, categoryName } from "@/lib/locale";

const errorText = (code: string) => (code === "limit" ? L("יש להזין סכום חיובי", "Enter a positive amount") : hebrewError(code));

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
  const owner = period.view ? period.people.find((p) => p.id === period.view)?.displayName : L("משק הבית", "Household");

  return (
    <>
      <ScopeBar path="/budgets" period={period} title={`${L("תקציבים", "Budgets")} · ${owner}`} />
      {params.error && <div role="alert" className="banner warn">{errorText(params.error)}</div>}
      {params.saved && <div role="status" className="banner ok">{L("נשמר", "Saved")}</div>}

      {budgets.length === 0 ? (
        <div className="card">{period.view ? L("עוד לא הוגדרו תקציבים אישיים.", "No personal budgets yet.") : L("עוד לא הוגדרו תקציבים.", "No budgets yet.")}{" "}
          {L("אפשר להתחיל מההצעות למטה, שמבוססות על ההוצאה בפועל ב-3 החודשים האחרונים.", "You can start from the suggestions below, based on actual spending in the last 3 months.")}</div>
      ) : (
        <section className="card stack">
          <h2>{L("החודש", "This month")}</h2>
          <ul className="barlist">
            {budgets.map((b) => {
              const s = BUDGET_STATE[b.status.state];
              const tip = `${categoryName(b.categoryName)}\n${money(b.status.spentMinor, { whole: true })} ${L("מתוך", "of")} ${money(b.status.limitMinor, { whole: true })}\n${L("צפי לסוף החודש", "Expected by month end")}: ${money(b.status.projectedMinor, { whole: true })}`;
              return (
                <li key={b.id} data-tip={tip} tabIndex={0} aria-label={tip.replace(/\n/g, ", ")}>
                  <div className="row spread small">
                    <span>
                      <Link href={periodHref("/transactions", period, { side: "spending", category: b.categorySlug })}>{categoryName(b.categoryName)}</Link>{" "}
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
                    <span>{b.status.projectedMinor !== b.status.spentMinor ? L(`בקצב הנוכחי: כ-${money(b.status.projectedMinor, { whole: true })} עד סוף החודש`, `At this pace: about ${money(b.status.projectedMinor, { whole: true })} by month end`) : ""}</span>
                    {canEdit && (
                      <form action={deleteBudgetAction}>
                        {hidden}
                        <input type="hidden" name="budgetId" value={b.id} />
                        <button className="btn" type="submit" style={{ minBlockSize: 32, padding: "4px 10px", fontSize: 12 }}>{L("הסרה", "Remove")}</button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="muted small" style={{ margin: 0 }}>{L("הקו על כל פס הוא סף ההתראה. ״בקצב לחריגה״ נבדק מהשבוע השני של החודש.", "The line on each bar is the alert threshold. \"On pace to exceed\" is checked from the second week of the month.")}</p>
        </section>
      )}

      {canEdit && (
        <>
          {suggestions.filter((s) => !budgeted.has(s.slug)).length > 0 && (
            <section className="card stack">
              <h2>{L("הצעות לפי 3 החודשים האחרונים", "Suggestions from the last 3 months")}</h2>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {suggestions.filter((s) => !budgeted.has(s.slug)).slice(0, 8).map((s) => (
                      <tr key={s.slug}>
                        <td>{s.name}</td>
                        <td className="num">{money(s.suggestedMinor!, { whole: true })} {L("לחודש", "/ month")}</td>
                        <td style={{ textAlign: "end" }}>
                          <form action={setBudgetAction}>
                            {hidden}
                            <input type="hidden" name="category" value={s.slug} />
                            <input type="hidden" name="limit" value={(Number(s.suggestedMinor) / 100).toFixed(0)} />
                            <button className="btn" type="submit">{L("הגדרה", "Set")}</button>
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
            <h2>{L("תקציב חדש או עדכון", "New budget or update")}</h2>
            {hidden}
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field-group" style={{ flex: "2 1 200px" }}>
                <label htmlFor="category">{L("קטגוריה", "Category")}</label>
                <select className="field" id="category" name="category" required defaultValue="">
                  <option value="" disabled>{L("בחירה…", "Choose…")}</option>
                  {cats.map((c) => <option key={c.id} value={c.slug}>{categoryName(c.nameHe)}</option>)}
                </select>
              </div>
              <div className="field-group" style={{ flex: "1 1 140px" }}>
                <label htmlFor="limit">{L("סכום לחודש (₪)", "Monthly amount (₪)")}</label>
                <input className="field num" id="limit" name="limit" inputMode="decimal" required dir="ltr" />
              </div>
              <div className="field-group" style={{ flex: "1 1 120px" }}>
                <label htmlFor="alert">{L("התראה ב-(%)", "Alert at (%)")}</label>
                <input className="field num" id="alert" name="alert" type="number" min={10} max={100} defaultValue={80} dir="ltr" />
              </div>
              <button className="btn primary" type="submit">{L("שמירה", "Save")}</button>
            </div>
          </form>
        </>
      )}
    </>
  );
}
