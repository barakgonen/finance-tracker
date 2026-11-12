import Link from "next/link";
import { healthHistory, healthScore } from "@ft/analytics";
import { HEALTH_CONFIG } from "@ft/core";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { monthName, percent } from "@/lib/format";
import { CONFIDENCE, DIMENSIONS, EFFECT, MISSING } from "@/lib/health-text";
import { periodHref, resolvePeriod } from "@/lib/period";
import { L } from "@/lib/locale";

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const { period, result, history } = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    return { period, result: await healthScore(tx, period.filters, period.month), history: await healthHistory(tx, period.filters, period.month) };
  });
  const scored = result.dimensions.filter((d) => d.weight > 0);
  const weightSum = scored.filter((d) => d.score !== null).reduce((a, d) => a + d.weight, 0);

  return (
    <>
      <ScopeBar path="/health" period={period} title={L("בריאות פיננסית", "Financial health")} />

      <section className="card row" style={{ alignItems: "center", "--gap": "28px" } as React.CSSProperties}>
        <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
          <span className="muted small">{L("הציון הכולל", "Overall score")}</span>
          {result.total === null ? (
            <span style={{ fontSize: 22, fontWeight: 600 }}>{L("אין עדיין מספיק נתונים", "Not enough data yet")}</span>
          ) : (
            <span style={{ fontSize: 56, fontWeight: 700, lineHeight: 1 }}>
              {result.total}
              <span className="muted" style={{ fontSize: 20, fontWeight: 400 }}> / 100</span>
            </span>
          )}
        </div>
        <div className="stack" style={{ flex: "1 1 300px", "--gap": "6px" } as React.CSSProperties}>
          {result.total === null ? (
            <p style={{ margin: 0 }}>
              {result.insufficient === "too_few_months"
                ? L(`הציון מחושב רק מ-3 חודשים מלאים לפחות (עם הכנסות והוצאות). כרגע יש ${result.monthsUsed}. ייבוא דוחות נוספים ישלים את התמונה.`, `The score needs at least 3 complete months (with income and expenses). There are ${result.monthsUsed} so far. Importing more statements will complete the picture.`)
                : L("אין מספיק מדדים עם נתונים כדי לתת ציון אמין.", "Not enough measures have data for a reliable score.")}
            </p>
          ) : (
            <p style={{ margin: 0 }}>{L(`מבוסס על ${result.monthsUsed} החודשים המלאים האחרונים, ממוצע משוקלל של ${scored.filter((d) => d.score !== null).length} מדדים.`, `Based on the last ${result.monthsUsed} complete months, a weighted average of ${scored.filter((d) => d.score !== null).length} measures.`)}</p>
          )}
          <span className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
            <span className={`chip ${result.confidence === "low" ? "warn" : "info"}`}>{CONFIDENCE[result.confidence]}</span>
            {result.unreviewedShare > 0.05 && (
              <span className="small muted">
                {percent(result.unreviewedShare)} {L("מהסכומים עדיין ממתינים לבדיקה.", "of the amounts are still waiting for review.")} <Link href="/review">{L("לבדיקה", "Review")}</Link>
              </span>
            )}
          </span>
        </div>
      </section>

      {result.focus.length > 0 && (
        <section className="card stack">
          <h2>{L("מה הכי ישפר את הציון", "What would improve the score most")}</h2>
          <ul className="stack" style={{ margin: 0, paddingInlineStart: 18, "--gap": "8px" } as React.CSSProperties}>
            {result.focus.map((k) => (
              <li key={k}><strong>{DIMENSIONS[k].name}:</strong> {DIMENSIONS[k].suggestion}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="card stack">
        <h2>{L("המדדים", "The measures")}</h2>
        <ul className="barlist">
          {scored.map((d) => {
            const text = DIMENSIONS[d.key];
            const tip = [text.name, d.score === null ? L("אין מספיק נתונים", "Not enough data") : L(`ציון ${d.score} מתוך 100`, `Score ${d.score} of 100`), d.value !== null ? text.value(d.value, result.monthsUsed) : MISSING[d.missing!]].join("\n");
            return (
              <li key={d.key} data-tip={tip} tabIndex={0} aria-label={tip.replace(/\n/g, ", ")}>
                <div className="row spread small">
                  <span>
                    <strong>{text.name}</strong>
                    <span className="muted">{` · ${L("משקל", "weight")} `}{weightSum && d.score !== null ? percent(d.weight / weightSum) : "—"}</span>
                  </span>
                  <span>{d.score === null ? <span className="muted">{L("אין מספיק נתונים", "Not enough data")}</span> : <><span className="num">{d.score}</span> <span className="muted">· {EFFECT[d.effect]}</span></>}</span>
                </div>
                <div className="bar-track" aria-hidden="true">
                  {d.score !== null && <span className="bar-fill" style={{ inlineSize: `${d.score}%`, background: "var(--accent)" }} />}
                </div>
                <span className="small muted">{d.value !== null ? text.value(d.value, result.monthsUsed) : MISSING[d.missing!]}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card stack">
        <h2>{L("הציון לאורך זמן", "Score over time")}</h2>
        <div className="table-wrap">
          <table>
            <thead><tr>{history.map((h) => <th key={h.month} scope="col">{monthName(h.month, true)}</th>)}</tr></thead>
            <tbody>
              <tr>
                {history.map((h) => (
                  <td key={h.month} className="num">
                    <Link href={periodHref("/health", { month: h.month, view: period.view })} style={{ color: "inherit" }}>{h.total ?? "—"}</Link>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{L("כל חודש מחושב מ-6 החודשים שהסתיימו בו. ״—״: עדיין לא היו מספיק נתונים.", "Each month is computed from the 6 months ending in it. \"—\": not enough data yet.")}</p>
      </section>

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>{L("איך מחושב הציון", "How the score is calculated")}</summary>
        <p className="small" style={{ lineHeight: 1.6 }}>
          {L(
            `כל מדד מקבל ציון בין 0 ל-100 לפי המיקום של הערך שנמדד בין ״הכי חלש״ (0) ל״הכי טוב״ (100). הציון הכולל הוא ממוצע משוקלל של המדדים שיש להם נתונים; מדד בלי נתונים לא נספר, והמשקל שלו מתחלק בין האחרים. אין ציון כולל לפני ${HEALTH_CONFIG.minMonths} חודשים מלאים ו-${HEALTH_CONFIG.minDimensions} מדדים לפחות.`,
            `Each measure gets a score from 0 to 100 by where its value falls between "weakest" (0) and "best" (100). The overall score is a weighted average of the measures that have data; a measure without data isn't counted and its weight is shared among the others. There's no overall score before ${HEALTH_CONFIG.minMonths} complete months and at least ${HEALTH_CONFIG.minDimensions} measures.`,
          )}
        </p>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">{L("מדד", "Measure")}</th><th scope="col">{L("משקל בסיס", "Base weight")}</th><th scope="col">{L("ציון 0", "Score 0")}</th><th scope="col">{L("ציון 100", "Score 100")}</th></tr></thead>
            <tbody>
              {Object.entries(HEALTH_CONFIG.dimensions).map(([k, c]) => {
                const t = DIMENSIONS[k as keyof typeof DIMENSIONS];
                return (
                  <tr key={k}>
                    <td>{t.name}</td>
                    <td className="num">{c.weight}</td>
                    <td className="num">{t.threshold(c.worst)}</td>
                    <td className="num">{t.threshold(c.best)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
