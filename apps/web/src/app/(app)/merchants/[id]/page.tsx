import Link from "next/link";
import { notFound } from "next/navigation";
import { latestMonth, merchantDetail, merchantList } from "@ft/analytics";
import { ColumnChart, SERIES } from "@/components/charts";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { money, monthName } from "@/lib/format";
import { categories } from "@/lib/queries";
import { mergeMerchantAction, renameMerchantAction, setMerchantCategoryAction } from "../actions";

export default async function MerchantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const { error, saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await scope(householdScope(viewer), async (tx) => {
    const month = (await latestMonth(tx, viewer.householdId)) ?? new Date().toISOString().slice(0, 7);
    const f = { householdId: viewer.householdId, viewerMemberId: viewer.memberId };
    const detail = await merchantDetail(tx, f, id, month);
    if (!detail) return null;
    return { month, detail, cats: await categories(tx, viewer.householdId), others: (await merchantList(tx, f)).filter((m) => m.id !== id) };
  });
  if (!data) notFound();
  const { month, detail, cats, others } = data;
  const currentCat = cats.find((c) => c.id === detail.defaultCategoryId)?.slug ?? "";
  const shown = detail.months.slice(Math.max(0, detail.months.findIndex((m) => m.count > 0)));
  const canEdit = viewer.role !== "viewer";
  const txHref = `/transactions?${new URLSearchParams({ month, side: "spending", merchant: id })}`;

  return (
    <>
      <Link href="/expenses?tab=merchants" className="small" style={{ textDecoration: "none" }}>→ בתי עסק</Link>
      <h1>{detail.name}</h1>
      {error && <div role="alert" className="banner warn">{error === "missing" ? "יש לבחור בית עסק" : error}</div>}
      {saved && <div role="status" className="banner ok">נשמר</div>}

      <section className="grid">
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">ב-12 החודשים האחרונים</span>
          <span className="kpi">{money(detail.totalMinor, { whole: true })}</span>
          <Link className="small" href={txHref}>{detail.count} עסקאות</Link>
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">ממוצע לעסקה</span>
          <span className="kpi">{money(detail.avgMinor)}</span>
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">סכומים נפוצים</span>
          {detail.commonAmounts.length === 0 ? <span className="muted">—</span> : detail.commonAmounts.map((a) => (
            <span key={String(a.amountMinor)} className="small"><span className="num">{money(a.amountMinor)}</span> · {a.count} פעמים</span>
          ))}
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">קטגוריות</span>
          {detail.categories.map((c) => <span key={c.slug ?? "none"} className="small">{c.name ?? "ללא קטגוריה"} · {c.count}</span>)}
        </div>
      </section>

      {shown.length > 1 && (
        <section className="card stack">
          <h2>הוצאה לפי חודש</h2>
          <ColumnChart
            title={`הוצאה ב${detail.name} לפי חודש`}
            labels={shown.map((m) => monthName(m.month, true))}
            fullLabels={shown.map((m) => monthName(m.month))}
            series={[{ name: "הוצאה", color: SERIES.expenses, values: shown.map((m) => m.minor) }]}
          />
        </section>
      )}

      {canEdit && (
        <section className="card stack">
          <h2>ניהול בית העסק</h2>
          <form action={setMerchantCategoryAction} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="merchantId" value={id} />
            <div className="field-group" style={{ flex: "1 1 240px" }}>
              <label htmlFor="cat">קטגוריה לכל העסקאות כאן (קודמות ועתידיות; עריכות ידניות נשמרות)</label>
              <select className="field" id="cat" name="category" defaultValue={currentCat}>
                <option value="">ללא (זיהוי אוטומטי)</option>
                {cats.filter((c) => c.type === "expense").map((c) => <option key={c.id} value={c.slug}>{c.nameHe}</option>)}
              </select>
            </div>
            <button className="btn primary" type="submit">שמירה</button>
          </form>
          <form action={renameMerchantAction} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="merchantId" value={id} />
            <div className="field-group" style={{ flex: "1 1 240px" }}>
              <label htmlFor="name">שם תצוגה</label>
              <input className="field" id="name" name="name" defaultValue={detail.name} required />
            </div>
            <button className="btn" type="submit">שינוי שם</button>
          </form>
          <form action={mergeMerchantAction} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="merchantId" value={id} />
            <div className="field-group" style={{ flex: "1 1 240px" }}>
              <label htmlFor="target">איחוד עם בית עסק אחר (אותו עסק בשם אחר)</label>
              <select className="field" id="target" name="targetId" defaultValue="">
                <option value="" disabled>בחירה…</option>
                {others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button className="btn" type="submit">איחוד</button>
          </form>
          <p className="muted small" style={{ margin: 0 }}>באיחוד, כל העסקאות עוברות לבית העסק שנבחר, וגם ייבואים עתידיים בשם הזה ישויכו אליו.</p>
        </section>
      )}
    </>
  );
}

