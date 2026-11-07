import Link from "next/link";
import { notFound } from "next/navigation";
import { ImportError, planReprocess } from "@ft/ingest";
import { householdScope, requireViewer } from "@/lib/auth";
import { ingestDeps, scope } from "@/lib/db";
import { hebrewError } from "@/lib/errors";
import { date, money } from "@/lib/format";
import { canSeeDetails } from "@/lib/queries";
import { importFile } from "@ft/db";
import { eq } from "drizzle-orm";
import { applyReprocessAction } from "./actions";

const FIELD_NAMES: Record<string, string> = {
  postingDate: "תאריך חיוב",
  originalAmount: "סכום מקורי",
  originalCurrency: "מטבע מקורי",
  categoryHint: "ענף",
  typeHint: "סוג עסקה",
  installmentNo: "מספר תשלום",
  installmentTotal: "מספר תשלומים",
  installmentOriginalAmount: "סכום העסקה בתשלומים",
  notes: "הערות",
};
const KEEP: Record<string, string> = { edited: "נשמרת: ערכתם אותה", pays_card_bill: "נשמרת: משולם בה חיוב כרטיס", split: "נשמרת: מפוצלת" };

export default async function ReprocessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const { error } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await scope(householdScope(viewer), async (tx) => {
    const [imp] = await tx.select().from(importFile).where(eq(importFile.id, id));
    if (!imp) return null;
    try {
      const plan = await planReprocess(ingestDeps(tx), viewer.householdId, id);
      const hidden = imp.accountId ? !(await canSeeDetails(tx, viewer.householdId, imp.accountId, viewer.memberId)) : false;
      return { imp, plan, hidden };
    } catch (e) {
      if (e instanceof ImportError) return { imp, plan: null, hidden: false, failure: e.message };
      throw e;
    }
  });
  if (!data) notFound();
  const { imp, plan, hidden } = data;
  const canEdit = viewer.role !== "viewer";

  return (
    <>
      <Link href={`/import/${id}`} className="small" style={{ textDecoration: "none" }}>→ חזרה לייבוא</Link>
      <h1>עיבוד מחדש · <span className="num">{imp.fileName}</span></h1>
      {error && <div role="alert" className="banner warn">{hebrewError(error)}</div>}
      {!plan ? (
        <div role="alert" className="banner warn">{hebrewError("failure" in data ? data.failure : undefined)}</div>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            הקובץ המקורי נקרא שוב בגרסה {plan.toVersion} של המפענח (הייבוא נקרא בגרסה {plan.fromVersion ?? "?"}). זו תצוגה מקדימה: שום דבר עוד לא השתנה. עריכות ידניות שלכם (קטגוריה, סוג, בעלים) נשמרות תמיד.
          </p>
          <section role="status" className={`banner ${plan.reconciliation.ok ? "ok" : "warn"}`}>
            {plan.reconciliation.ok ? "הקריאה החדשה תואמת לסכומים שבדוח." : `הקריאה החדשה לא תואמת לסכומים שבדוח: ${plan.reconciliation.problems.join("; ")}`}
          </section>

          {plan.committed ? (
            <>
              <section className="grid">
                <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">יתווספו</span><span className="kpi">{plan.added.length}</span></div>
                <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">יתעדכנו</span><span className="kpi">{plan.updated.length}</span></div>
                <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">כבר לא בדוח</span><span className="kpi">{plan.removed.length}</span></div>
                <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">ללא שינוי</span><span className="kpi">{plan.unchanged}</span></div>
              </section>
              {hidden ? (
                <div role="note" className="banner ok">זה חשבון פרטי של חבר/ה אחר/ת במשק הבית: רואים רק את הסיכום.</div>
              ) : (
                <>
                  {plan.added.length > 0 && (
                    <section className="card stack">
                      <h2>תנועות שהגרסה הקודמת פספסה</h2>
                      <ul className="small" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>
                        {plan.added.map((a, i) => <li key={i}><span className="num">{date(a.purchaseDate)}</span> · {a.description} · <span className="num">{money(a.amountMinor, { signed: true })}</span></li>)}
                      </ul>
                    </section>
                  )}
                  {plan.updated.length > 0 && (
                    <section className="card stack">
                      <h2>תנועות שיתוקנו</h2>
                      <ul className="small" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>
                        {plan.updated.map((u) => <li key={u.transactionId}>{u.description}: {u.changes.map((c) => FIELD_NAMES[c] ?? c).join(", ")}</li>)}
                      </ul>
                    </section>
                  )}
                  {plan.removed.length > 0 && (
                    <section className="card stack">
                      <h2>תנועות שכבר לא מופיעות בקריאה החדשה</h2>
                      <ul className="small" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>
                        {plan.removed.map((r) => (
                          <li key={r.transactionId}>
                            <span className="num">{date(r.purchaseDate)}</span> · {r.description} · <span className="num">{money(r.amountMinor, { signed: true })}</span>
                            {r.duplicate ? <span className="muted"> · כפילות של ייבוא אחר</span> : null}
                            {r.keep ? <span className="muted"> · {KEEP[r.keep]}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="card">הייבוא עוד לא אושר, אז רק התצוגה המקדימה שלו תתעדכן.</div>
          )}

          {canEdit && (
            <form action={applyReprocessAction} className="card stack">
              <input type="hidden" name="importId" value={id} />
              {plan.committed && plan.removed.some((r) => !r.keep) && (
                <label className="check">
                  <input type="checkbox" name="removeMissing" /> להסיר גם את התנועות שכבר לא מופיעות (אלה שלא ערכתם)
                </label>
              )}
              {!plan.reconciliation.ok && (
                <div className="field-group">
                  <label htmlFor="reason">עיבוד בכל זאת דורש סיבה (נשמרת ביומן השינויים)</label>
                  <input className="field" id="reason" name="reason" required />
                </div>
              )}
              <div className="row">
                <button className="btn primary" type="submit">עיבוד מחדש</button>
                <Link href={`/import/${id}`}>ביטול</Link>
              </div>
            </form>
          )}
        </>
      )}
    </>
  );
}
