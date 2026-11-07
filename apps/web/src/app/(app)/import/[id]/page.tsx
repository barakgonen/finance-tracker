import Link from "next/link";
import { notFound } from "next/navigation";
import { billsOfImport } from "@ft/analytics";
import { getPreview, ImportError } from "@ft/ingest";
import { currentParserVersion } from "@ft/parsers";
import { importFile } from "@ft/db";
import { eq } from "drizzle-orm";
import { householdScope, requireViewer } from "@/lib/auth";
import { ingestDeps, scope } from "@/lib/db";
import { date, money } from "@/lib/format";
import { messages } from "@/lib/i18n";
import { accounts, canSeeDetails, categories } from "@/lib/queries";
import { commitAction, discardAction } from "../actions";

const COMMIT_ERRORS: Record<string, string> = {
  no_account: "יש לבחור חשבון לפני הייבוא.",
  unreconciled: "הסכומים לא תואמים. כדי לייבא בכל זאת יש לכתוב סיבה.",
  account_mismatch: "סוג הדוח לא מתאים לחשבון שנבחר (בנק מול כרטיס).",
  bad_state: "הייבוא הזה כבר טופל.",
};

export default async function PreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; reprocessed?: string }> }) {
  const viewer = await requireViewer();
  const t = messages(viewer.locale);
  const { id } = await params;
  const { error, reprocessed } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const data = await scope(householdScope(viewer), async (tx) => {
    try {
      const preview = await getPreview(ingestDeps(tx), viewer.householdId, id);
      const hidden = preview.accountId ? !(await canSeeDetails(tx, viewer.householdId, preview.accountId, viewer.memberId)) : false;
      const [imp] = await tx.select({ v: importFile.parserVersion }).from(importFile).where(eq(importFile.id, id));
      const bills = preview.status === "committed" && !hidden ? await billsOfImport(tx, { householdId: viewer.householdId, viewerMemberId: viewer.memberId }, id) : [];
      return {
        preview: hidden ? { ...preview, rows: [] } : preview,
        hidden,
        bills,
        parserVersion: imp?.v ?? null,
        accts: await accounts(tx, viewer.householdId),
        cats: await categories(tx, viewer.householdId),
      };
    } catch (e) {
      if (e instanceof ImportError && e.code === "not_found") return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { preview, hidden, bills, accts, cats, parserVersion } = data;
  const installed = preview.adapter ? currentParserVersion(preview.adapter) : null;
  const outdated = (preview.status === "committed" || preview.status === "parsed") && installed !== null && (parserVersion ?? 0) < installed;
  const catName = new Map(cats.map((c) => [c.slug, c.nameHe]));
  const rec = preview.reconciliation;
  const canEdit = viewer.role !== "viewer" && preview.status === "parsed";
  const toCommit = preview.counts.new + preview.counts.supersedesPending;

  return (
    <>
      <Link href="/import" className="small" style={{ textDecoration: "none" }}>→ {t.import.history}</Link>
      <h1>{t.import.previewTitle}</h1>

      <section className="card row">
        <div className="stack" style={{ flex: "1 1 240px", "--gap": "2px" } as React.CSSProperties}>
          <strong className="num">{preview.fileName}</strong>
          <span className="muted small">{preview.adapter ?? "—"}</span>
        </div>
        {preview.status === "committed" && <span className="chip ok">{t.import.committed}</span>}
        {preview.status === "discarded" && <span className="chip">{t.import.discarded}</span>}
      </section>

      {error && <div role="alert" className="banner warn">{COMMIT_ERRORS[error] ?? t.errors.generic}</div>}
      {reprocessed && <div role="status" className="banner ok">הקובץ עובד מחדש בגרסה החדשה של המפענח.</div>}
      {outdated && (
        <div role="note" className="banner warn">
          <span>
            קיימת גרסה חדשה של המפענח לקובץ הזה. <Link href={`/import/${preview.importId}/reprocess`}>בדיקת עיבוד מחדש</Link>
          </span>
        </div>
      )}
      {hidden && <div role="note" className="banner ok">זה חשבון פרטי של חבר/ה אחר/ת במשק הבית: רואים כאן רק את הסיכום, בלי התנועות.</div>}
      {preview.error && <div role="alert" className="banner error">{t.import.failed}: {preview.error}</div>}

      {rec && (
        <section role="status" className={`banner ${rec.ok ? "ok" : "warn"}`}>
          <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
            <strong>{rec.ok ? t.import.verified : t.import.notVerified}</strong>
            {rec.checks.map((c) => (
              <span key={c.label} className="small">
                {c.label.startsWith("running balance") ? "רצף היתרות בדוח" : c.label}:{" "}
                {c.ok ? "תואם" : <>צפוי <span className="num">{money(c.expectedMinor)}</span>, נמצא <span className="num">{money(c.actualMinor)}</span></>}
              </span>
            ))}
            {rec.problems.length > 0 && rec.checks.length === 0 && <span className="small">אין בדוח סכומים מודפסים לבדיקה.</span>}
          </div>
        </section>
      )}

      {bills.length > 0 && (
        <section className="card stack" aria-labelledby="bank-side" style={{ "--gap": "6px" } as React.CSSProperties}>
          <h2 id="bank-side">החיוב בבנק</h2>
          {bills.map((b) => (
            <div key={b.billId} className="row spread small">
              <span>
                {b.label} · <span className="num">{date(b.postingDate)}</span> · <strong className="num">{money(b.totalMinor)}</strong>
              </span>
              {b.debit ? (
                <span>
                  <span className="chip ok">נמצא בבנק</span> {b.debit.accountName}, <span className="num">{date(b.debit.date)}</span>
                  {b.debit.billsPaid > 1 ? <>, בחיוב אחד של <span className="num">{money(-b.debit.amountMinor)}</span> יחד עם עוד {b.debit.billsPaid - 1} דוחות</> : null} ·{" "}
                  <Link href={`/transactions?month=${b.postingDate.slice(0, 7)}&bill=${b.billId}`}>התנועות</Link>
                </span>
              ) : (
                <span className="muted"><span className="chip">עוד לא בבנק</span> יקושר אוטומטית כשתנועות הבנק של החודש ייובאו</span>
              )}
            </div>
          ))}
          <p className="muted small" style={{ margin: 0 }}>החיוב בבנק לא נספר כהוצאה: ההוצאה נספרת פעם אחת, לפי התנועות בדוח.</p>
        </section>
      )}

      {preview.rows.length > 0 && (
        <section className="grid" aria-label="סיכום שורות">
          <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">{t.import.counts.new}</span><span className="kpi num">{preview.counts.new}</span></div>
          <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">{t.import.counts.duplicate}</span><span className="kpi num muted">{preview.counts.duplicate}</span></div>
          <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">{t.import.counts.supersedes}</span><span className="kpi num">{preview.counts.supersedesPending}</span></div>
          <div className="card stack" style={{ "--gap": "4px" } as React.CSSProperties}><span className="muted small">{t.import.counts.review}</span><span className="kpi num" style={{ color: "var(--warn-ink)" }}>{preview.counts.needsReview}</span></div>
        </section>
      )}
      {preview.warnings.map((w) => (
        <p key={w} className="muted small" style={{ margin: 0 }}>{w}</p>
      ))}

      {canEdit && (
        <form action={commitAction} className="card stack">
          <input type="hidden" name="importId" value={preview.importId} />
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field-group" style={{ flex: "1 1 260px" }}>
              <label htmlFor="accountId">{t.import.chooseAccount}</label>
              <select className="field" id="accountId" name="accountId" defaultValue={preview.accountId ?? ""} required>
                <option value="" disabled>—</option>
                {accts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            {rec && !rec.ok && (
              <div className="field-group" style={{ flex: "2 1 320px" }}>
                <label htmlFor="reason">{t.import.overrideReason}</label>
                <input className="field" id="reason" name="reason" required />
              </div>
            )}
            <button className="btn primary" type="submit">
              {rec && !rec.ok ? t.import.commitAnyway : `${t.import.commit} ${toCommit}`}
            </button>
          </div>
        </form>
      )}

      {preview.rows.length > 0 && (
        <section className="card" style={{ padding: "6px 4px" }} aria-label="שורות הדוח">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.import.columns.date}</th>
                  <th scope="col">{t.import.columns.description}</th>
                  <th scope="col">{t.import.columns.amount}</th>
                  <th scope="col">{t.import.columns.category}</th>
                  <th scope="col">{t.import.columns.source}</th>
                  <th scope="col">{t.import.columns.status}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const c = r.classification;
                  const label = c.category ? catName.get(c.category) : c.kind !== "expense" && c.kind !== "refund" ? t.kinds[c.kind] : undefined;
                  return (
                    <tr key={r.rowIndex} className={r.status === "duplicate" ? "dim" : undefined}>
                      <td className="num">{date(r.purchaseDate)}</td>
                      <td>{r.description}</td>
                      <td><span className="num" style={{ color: r.amountMinor > 0n ? "var(--income)" : undefined }}>{money(r.amountMinor, { signed: true })}</span></td>
                      <td>{c.needsReview && r.status !== "duplicate" ? <span className="chip warn">{label ? `${label}?` : t.import.needsReview}</span> : (label ?? "—")}</td>
                      <td className="muted small">{t.sources[c.source]}</td>
                      <td>
                        {r.status === "new" && <span className="chip ok">{t.import.new}</span>}
                        {r.status === "duplicate" && <span className="chip">{t.import.duplicateRow}</span>}
                        {r.status === "supersedes_pending" && <span className="chip info">{t.import.supersedes}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canEdit && (
        <form action={discardAction}>
          <input type="hidden" name="importId" value={preview.importId} />
          <button className="btn" type="submit">{t.import.discard}</button>
        </form>
      )}
    </>
  );
}

