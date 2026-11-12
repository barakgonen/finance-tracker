import { goalsWithProgress } from "@ft/analytics";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { hebrewError } from "@/lib/errors";
import { date, money, monthName, percent } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import { GOAL_STATE, GOAL_TYPE } from "@/lib/planning-text";
import { categories } from "@/lib/queries";
import { archiveGoalAction, createGoalAction } from "./actions";
import { L, categoryName as categoryNameOf } from "@/lib/locale";

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string; error?: string; saved?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const { period, goals, cats } = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    return {
      period,
      goals: await goalsWithProgress(tx, period.filters, period.month),
      cats: (await categories(tx, viewer.householdId)).filter((c) => c.type === "expense" && c.slug !== "card_unitemized"),
    };
  });
  const canEdit = viewer.role !== "viewer";
  const hidden = (
    <>
      <input type="hidden" name="month" value={period.month} />
      {period.view && <input type="hidden" name="view" value={period.view} />}
    </>
  );

  return (
    <>
      <ScopeBar path="/goals" period={period} title={`${L("יעדים", "Goals")} · ${period.view ? period.people.find((p) => p.id === period.view)?.displayName : L("משותפים", "Shared")}`} />
      {params.error && <div role="alert" className="banner warn">{hebrewError(params.error)}</div>}
      {params.saved && <div role="status" className="banner ok">{L("נשמר", "Saved")}</div>}

      {goals.length === 0 && <div className="card">{L("עוד לא הוגדרו יעדים. ההתקדמות מחושבת מהתנועות עצמן, ונכנסת גם לציון הבריאות הפיננסית.", "No goals yet. Progress is calculated from the transactions themselves and also feeds the financial health score.")}</div>}
      <div className="grid">
        {goals.map(({ goal: g, categoryName, progress: p }) => {
          const s = GOAL_STATE[p.state];
          return (
            <article key={g.id} className="card stack" style={{ "--gap": "10px" } as React.CSSProperties}>
              <div className="row spread small">
                <span className="muted">{GOAL_TYPE[g.type]} · {L("מ", "from ")}{monthName(g.startMonth)}</span>
                <span className={`chip ${s.tone}`}>{s.label}</span>
              </div>
              <h2>{g.name}</h2>
              <div className="bar-track" aria-hidden="true"><span className="bar-fill" style={{ inlineSize: `${p.progress * 100}%`, background: "var(--accent)" }} /></div>
              <span className="small">
                {g.type === "save_amount" && p.savedMinor !== undefined && (
                  <>
                    {L("נחסכו", "Saved")} <span className="num">{money(p.savedMinor, { whole: true })}</span> {L("מתוך", "of")} <span className="num">{money(g.targetAmount!, { whole: true })}</span>
                    {p.requiredMonthlyMinor ? <> · {L("נדרש", "needs")} <span className="num">{money(p.requiredMonthlyMinor, { whole: true })}</span> {L("בחודש עד", "a month until")} {date(g.deadline!)}</> : null}
                  </>
                )}
                {g.type === "savings_rate" && p.currentRate !== undefined && <>{L("שיעור החיסכון ב-3 החודשים האחרונים", "Savings rate over the last 3 months")}: {percent(p.currentRate)} ({L("יעד", "goal")} {percent(g.targetRate!)})</>}
                {g.type === "reduce_category" && p.targetMonthlyMinor !== undefined && (
                  <>
                    {categoryName && categoryNameOf(categoryName)}: {L("החודש", "this month")} <span className="num">{money(p.currentMonthlyMinor!, { whole: true })}</span>, {L("יעד", "goal")} <span className="num">{money(p.targetMonthlyMinor, { whole: true })}</span>
                    <span className="muted"> ({L("ממוצע קודם", "earlier average")} {money(g.baselineMonthly!, { whole: true })})</span>
                  </>
                )}
                {p.state === "no_data" && <span className="muted">{L("אין עדיין תנועות מתחילת היעד.", "No transactions since the goal started yet.")}</span>}
              </span>
              {canEdit && (
                <form action={archiveGoalAction}>
                  {hidden}
                  <input type="hidden" name="goalId" value={g.id} />
                  <button className="btn" type="submit" style={{ minBlockSize: 32, padding: "4px 10px", fontSize: 12 }}>{L("העברה לארכיון", "Archive")}</button>
                </form>
              )}
            </article>
          );
        })}
      </div>

      {canEdit && (
        <section className="stack">
          <h2>{L("יעד חדש (מתחיל ב", "New goal (starting ")}{monthName(period.month)})</h2>
          <div className="grid">
            <form action={createGoalAction} className="card stack">
              {hidden}
              <input type="hidden" name="type" value="save_amount" />
              <strong>{GOAL_TYPE.save_amount}</strong>
              <div className="field-group"><label htmlFor="g1-name">{L("שם", "Name")}</label><input className="field" id="g1-name" name="name" required placeholder={L("קרן חירום", "Emergency fund")} /></div>
              <div className="field-group"><label htmlFor="g1-target">{L("סכום (₪)", "Amount (₪)")}</label><input className="field num" id="g1-target" name="target" inputMode="decimal" required dir="ltr" /></div>
              <div className="field-group"><label htmlFor="g1-deadline">{L("עד תאריך (לא חובה)", "By date (optional)")}</label><input className="field" id="g1-deadline" name="deadline" type="date" dir="ltr" /></div>
              <button className="btn primary" type="submit">{L("הוספה", "Add")}</button>
            </form>
            <form action={createGoalAction} className="card stack">
              {hidden}
              <input type="hidden" name="type" value="savings_rate" />
              <strong>{GOAL_TYPE.savings_rate}</strong>
              <div className="field-group"><label htmlFor="g2-name">{L("שם", "Name")}</label><input className="field" id="g2-name" name="name" required placeholder={L("לחסוך 20% מההכנסה", "Save 20% of income")} /></div>
              <div className="field-group"><label htmlFor="g2-rate">{L("שיעור יעד (%)", "Target rate (%)")}</label><input className="field num" id="g2-rate" name="rate" type="number" min={1} max={99} required dir="ltr" defaultValue={20} /></div>
              <button className="btn primary" type="submit">{L("הוספה", "Add")}</button>
            </form>
            <form action={createGoalAction} className="card stack">
              {hidden}
              <input type="hidden" name="type" value="reduce_category" />
              <strong>{GOAL_TYPE.reduce_category}</strong>
              <div className="field-group"><label htmlFor="g3-name">{L("שם", "Name")}</label><input className="field" id="g3-name" name="name" required placeholder={L("פחות משלוחים", "Less food delivery")} /></div>
              <div className="field-group">
                <label htmlFor="g3-cat">{L("קטגוריה", "Category")}</label>
                <select className="field" id="g3-cat" name="category" required defaultValue="">
                  <option value="" disabled>{L("בחירה…", "Choose…")}</option>
                  {cats.map((c) => <option key={c.id} value={c.slug}>{categoryNameOf(c.nameHe)}</option>)}
                </select>
              </div>
              <div className="field-group"><label htmlFor="g3-pct">{L("להוריד ב-(%)", "Reduce by (%)")}</label><input className="field num" id="g3-pct" name="pct" type="number" min={1} max={99} required dir="ltr" defaultValue={15} /></div>
              <span className="muted small">{L("היעד נמדד מול ממוצע 3 החודשים שלפני תחילתו.", "Measured against the average of the 3 months before it starts.")}</span>
              <button className="btn primary" type="submit">{L("הוספה", "Add")}</button>
            </form>
          </div>
        </section>
      )}
    </>
  );
}
