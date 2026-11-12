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
import { isRtl, L } from "@/lib/locale";

const FIELD_NAMES: Record<string, string> = {
  get postingDate() {
    return L("תאריך חיוב", "Charge date");
  },
  get originalAmount() {
    return L("סכום מקורי", "Original amount");
  },
  get originalCurrency() {
    return L("מטבע מקורי", "Original currency");
  },
  get categoryHint() {
    return L("ענף", "Issuer category");
  },
  get typeHint() {
    return L("סוג עסקה", "Transaction type");
  },
  get installmentNo() {
    return L("מספר תשלום", "Installment number");
  },
  get installmentTotal() {
    return L("מספר תשלומים", "Number of installments");
  },
  get installmentOriginalAmount() {
    return L("סכום העסקה בתשלומים", "Installment purchase amount");
  },
  get notes() {
    return L("הערות", "Notes");
  },
};
const keepReason = (k: string) =>
  ({ edited: L("נשמרת: ערכתם אותה", "Kept: you edited it"), pays_card_bill: L("נשמרת: משולם בה חיוב כרטיס", "Kept: it pays a card bill"), split: L("נשמרת: מפוצלת", "Kept: it is split") })[k] ?? k;

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
      <Link href={`/import/${id}`} className="small" style={{ textDecoration: "none" }}>{isRtl() ? "→" : "←"} {L("חזרה לייבוא", "Back to the import")}</Link>
      <h1>{L("עיבוד מחדש", "Re-process")} · <span className="num">{imp.fileName}</span></h1>
      {error && <div role="alert" className="banner warn">{hebrewError(error)}</div>}
      {!plan ? (
        <div role="alert" className="banner warn">{hebrewError("failure" in data ? data.failure : undefined)}</div>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            {L(
              `הקובץ המקורי נקרא שוב בגרסה ${plan.toVersion} של המפענח (הייבוא נקרא בגרסה ${plan.fromVersion ?? "?"}). זו תצוגה מקדימה: שום דבר עוד לא השתנה. עריכות ידניות שלכם (קטגוריה, סוג, בעלים) נשמרות תמיד.`,
              `The original file was read again with parser version ${plan.toVersion} (the import used version ${plan.fromVersion ?? "?"}). This is a preview: nothing has changed yet. Your manual edits (category, type, owner) are always kept.`,
            )}
          </p>
          <section role="status" className={`banner ${plan.reconciliation.ok ? "ok" : "warn"}`}>
            {plan.reconciliation.ok
              ? L("הקריאה החדשה תואמת לסכומים שבדוח.", "The new reading matches the statement's totals.")
              : `${L("הקריאה החדשה לא תואמת לסכומים שבדוח", "The new reading doesn't match the statement's totals")}: ${plan.reconciliation.problems.join("; ")}`}
          </section>

          {plan.committed ? (
            <>
              <section className="grid">
                <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">{L("יתווספו", "Will be added")}</span><span className="kpi">{plan.added.length}</span></div>
                <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">{L("יתעדכנו", "Will be updated")}</span><span className="kpi">{plan.updated.length}</span></div>
                <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">{L("כבר לא בדוח", "No longer in the statement")}</span><span className="kpi">{plan.removed.length}</span></div>
                <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">{L("ללא שינוי", "Unchanged")}</span><span className="kpi">{plan.unchanged}</span></div>
              </section>
              {hidden ? (
                <div role="note" className="banner ok">{L("זה חשבון פרטי של חבר/ה אחר/ת במשק הבית: רואים רק את הסיכום.", "This is another household member's private account: only the summary is shown.")}</div>
              ) : (
                <>
                  {plan.added.length > 0 && (
                    <section className="card stack">
                      <h2>{L("תנועות שהגרסה הקודמת פספסה", "Transactions the previous version missed")}</h2>
                      <ul className="small" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>
                        {plan.added.map((a, i) => <li key={i}><span className="num">{date(a.purchaseDate)}</span> · {a.description} · <span className="num">{money(a.amountMinor, { signed: true })}</span></li>)}
                      </ul>
                    </section>
                  )}
                  {plan.updated.length > 0 && (
                    <section className="card stack">
                      <h2>{L("תנועות שיתוקנו", "Transactions that will be corrected")}</h2>
                      <ul className="small" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>
                        {plan.updated.map((u) => <li key={u.transactionId}>{u.description}: {u.changes.map((c) => FIELD_NAMES[c] ?? c).join(", ")}</li>)}
                      </ul>
                    </section>
                  )}
                  {plan.removed.length > 0 && (
                    <section className="card stack">
                      <h2>{L("תנועות שכבר לא מופיעות בקריאה החדשה", "Transactions no longer in the new reading")}</h2>
                      <ul className="small" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>
                        {plan.removed.map((r) => (
                          <li key={r.transactionId}>
                            <span className="num">{date(r.purchaseDate)}</span> · {r.description} · <span className="num">{money(r.amountMinor, { signed: true })}</span>
                            {r.duplicate ? <span className="muted"> · {L("כפילות של ייבוא אחר", "duplicate of another import")}</span> : null}
                            {r.keep ? <span className="muted"> · {keepReason(r.keep)}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="card">{L("הייבוא עוד לא אושר, אז רק התצוגה המקדימה שלו תתעדכן.", "The import isn't approved yet, so only its preview will update.")}</div>
          )}

          {canEdit && (
            <form action={applyReprocessAction} className="card stack">
              <input type="hidden" name="importId" value={id} />
              {plan.committed && plan.removed.some((r) => !r.keep) && (
                <label className="check">
                  <input type="checkbox" name="removeMissing" /> {L("להסיר גם את התנועות שכבר לא מופיעות (אלה שלא ערכתם)", "Also remove transactions that no longer appear (ones you didn't edit)")}
                </label>
              )}
              {!plan.reconciliation.ok && (
                <div className="field-group">
                  <label htmlFor="reason">{L("עיבוד בכל זאת דורש סיבה (נשמרת ביומן השינויים)", "Re-processing anyway needs a reason (kept in the change log)")}</label>
                  <input className="field" id="reason" name="reason" required />
                </div>
              )}
              <div className="row">
                <button className="btn primary" type="submit">{L("עיבוד מחדש", "Re-process")}</button>
                <Link href={`/import/${id}`}>{L("ביטול", "Cancel")}</Link>
              </div>
            </form>
          )}
        </>
      )}
    </>
  );
}
