import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { INCOME_KINDS, SPENDING_KINDS } from "@ft/core";
import { transaction } from "@ft/db";
import { splitsOf } from "@ft/ingest";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { hebrewError } from "@/lib/errors";
import { date, money } from "@/lib/format";
import { categoryName, isRtl, L } from "@/lib/locale";
import { canSeeDetails, categories, members } from "@/lib/queries";
import { splitAction, unsplitAction } from "./actions";

const MAX_PARTS = 8;
function readDraft(raw: string | undefined): { a: string; c: string; m: string }[] | null {
  if (!raw) return null;
  try {
    const rows = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(rows)) return null;
    return rows.slice(0, MAX_PARTS).map((r) => ({ a: String(r?.a ?? "").slice(0, 20), c: String(r?.c ?? "").slice(0, 40), m: String(r?.m ?? "").slice(0, 40) }));
  } catch {
    return null;
  }
}
const shekels = (minor: bigint) => (Number(minor < 0n ? -minor : minor) / 100).toFixed(2).replace(/\.00$/, "");

export default async function SplitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; back?: string; rows?: string; draft?: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const q = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await scope(householdScope(viewer), async (tx) => {
    const [t] = await tx.select().from(transaction).where(and(eq(transaction.householdId, viewer.householdId), eq(transaction.id, id)));
    if (!t || !(await canSeeDetails(tx, viewer.householdId, t.accountId, viewer.memberId))) return null;
    return { t, parts: (await splitsOf(tx, viewer.householdId, [id])).get(id) ?? [], cats: await categories(tx, viewer.householdId), people: await members(tx, viewer.householdId) };
  });
  if (!data) notFound();
  const { t, parts, cats, people } = data;
  const owner = t.isShared || !t.memberId ? "shared" : t.memberId;
  // after a failed save: exactly what was typed; otherwise the saved parts
  const rowsShown: { a: string; c: string; m: string }[] =
    readDraft(q.draft) ?? parts.map((p) => ({ a: shekels(p.amountMinor), c: p.categorySlug ?? "", m: p.memberId ?? "shared" }));
  const back = q.back && /^\/(?![/\\])/.test(q.back) ? q.back : `/transactions?month=${t.purchaseDate.slice(0, 7)}`;
  const spending = SPENDING_KINDS.has(t.kind);
  const splittable = spending || INCOME_KINDS.has(t.kind);
  const options = cats.filter((c) => c.type === (spending ? "expense" : "income"));
  const filled = rowsShown.filter((r) => r.a || r.c).length;
  const rows = Math.min(MAX_PARTS, Math.max(Number(q.rows) || 0, filled + 1, 3));
  const readOnly = viewer.role === "viewer";

  return (
    <>
      <Link href={back} className="small" style={{ textDecoration: "none" }}>{isRtl() ? "→" : "←"} {L("חזרה לתנועות", "Back to transactions")}</Link>
      <h1>{L("פיצול תנועה", "Split a transaction")}</h1>
      <section className="card row spread">
        <div className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
          <strong>{t.descriptionRaw}</strong>
          <span className="muted small num">{date(t.purchaseDate)}</span>
        </div>
        <span className="kpi num">{money(t.amount, { signed: true })}</span>
      </section>
      {q.error && <div role="alert" className="banner warn">{hebrewError(q.error)}</div>}
      {!splittable ? (
        <div className="card">{L("אפשר לפצל רק הוצאות או הכנסות.", "Only expenses or income can be split.")}</div>
      ) : readOnly ? (
        <div className="card">{hebrewError("Read-only members can't make changes")}</div>
      ) : (
        <form action={splitAction} className="card stack">
          <input type="hidden" name="transactionId" value={t.id} />
          <input type="hidden" name="back" value={back} />
          <p className="muted small" style={{ margin: 0 }}>
            {L("חלקו את הסכום בין קטגוריות או בין אנשים. החלקים צריכים להסתכם בדיוק ב-", "Divide the amount between categories or people. The parts must add up exactly to ")}
            <span className="num">{money(t.amount < 0n ? -t.amount : t.amount)}</span>
            {L(". שורות ריקות לא נספרות.", ". Empty rows are ignored.")}
          </p>
          {Array.from({ length: rows }, (_, i) => {
            const p = rowsShown[i];
            return (
              <div key={i} className="row" style={{ alignItems: "flex-end" }}>
                <div className="field-group" style={{ flex: "1 1 120px" }}>
                  <label htmlFor={`amount-${i}`}>{L(`סכום ${i + 1} (₪)`, `Amount ${i + 1} (₪)`)}</label>
                  <input className="field num" id={`amount-${i}`} name={`amount-${i}`} inputMode="decimal" dir="ltr" defaultValue={p?.a ?? ""} />
                </div>
                <div className="field-group" style={{ flex: "2 1 200px" }}>
                  <label htmlFor={`category-${i}`}>{L("קטגוריה", "Category")}</label>
                  <select className="field" id={`category-${i}`} name={`category-${i}`} defaultValue={p?.c ?? ""}>
                    <option value="">{L("ללא קטגוריה", "Uncategorized")}</option>
                    {options.map((c) => <option key={c.id} value={c.slug}>{categoryName(c.nameHe)}</option>)}
                  </select>
                </div>
                {people.length > 1 && (
                  <div className="field-group" style={{ flex: "1 1 140px" }}>
                    <label htmlFor={`member-${i}`}>{L("של מי", "Whose")}</label>
                    <select className="field" id={`member-${i}`} name={`member-${i}`} defaultValue={p?.m || owner}>
                      {people.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                      <option value="shared">{L("משותף", "Shared")}</option>
                    </select>
                  </div>
                )}
              </div>
            );
          })}
          <div className="row">
            <button className="btn primary" type="submit">{L("שמירת הפיצול", "Save the split")}</button>
            {rows < MAX_PARTS && (
              <Link className="small" href={`/transactions/${t.id}/split?rows=${rows + 1}&back=${encodeURIComponent(back)}`}>{L("עוד שורה", "Another row")}</Link>
            )}
          </div>
        </form>
      )}
      {!readOnly && parts.length > 0 && (
        <form action={unsplitAction}>
          <input type="hidden" name="transactionId" value={t.id} />
          <input type="hidden" name="back" value={back} />
          <button className="btn" type="submit">{L("ביטול הפיצול", "Remove the split")}</button>
        </form>
      )}
    </>
  );
}
