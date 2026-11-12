import Link from "next/link";
import { notFound } from "next/navigation";
import { latestMonth, merchantDetail, merchantList } from "@ft/analytics";
import { ColumnChart, SERIES } from "@/components/charts";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { hebrewError } from "@/lib/errors";
import { money, monthName } from "@/lib/format";
import { categories } from "@/lib/queries";
import { mergeMerchantAction, renameMerchantAction, setMerchantCategoryAction } from "../actions";
import { isRtl, L, categoryName } from "@/lib/locale";

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
      <Link href="/expenses?tab=merchants" className="small" style={{ textDecoration: "none" }}>{isRtl() ? "→" : "←"} {L("בתי עסק", "Merchants")}</Link>
      <h1>{detail.name}</h1>
      {error && <div role="alert" className="banner warn">{error === "missing" ? L("יש לבחור בית עסק", "Choose a merchant") : hebrewError(error)}</div>}
      {saved && <div role="status" className="banner ok">{L("נשמר", "Saved")}</div>}

      <section className="grid">
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">{L("ב-12 החודשים האחרונים", "In the last 12 months")}</span>
          <span className="kpi">{money(detail.totalMinor, { whole: true })}</span>
          <Link className="small" href={txHref}>{detail.count} {L("עסקאות", "purchases")}</Link>
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">{L("ממוצע לעסקה", "Average purchase")}</span>
          <span className="kpi">{money(detail.avgMinor)}</span>
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">{L("סכומים נפוצים", "Common amounts")}</span>
          {detail.commonAmounts.length === 0 ? <span className="muted">—</span> : detail.commonAmounts.map((a) => (
            <span key={String(a.amountMinor)} className="small"><span className="num">{money(a.amountMinor)}</span> · {a.count} {L("פעמים", "times")}</span>
          ))}
        </div>
        <div className="card stack" style={{ "--gap": "6px" } as React.CSSProperties}>
          <span className="muted small">{L("קטגוריות", "Categories")}</span>
          {detail.categories.map((c) => <span key={c.slug ?? "none"} className="small">{c.name ? categoryName(c.name) : L("ללא קטגוריה", "Uncategorized")} · {c.count}</span>)}
        </div>
      </section>

      {shown.length > 1 && (
        <section className="card stack">
          <h2>{L("הוצאה לפי חודש", "Spending by month")}</h2>
          <ColumnChart
            title={L(`הוצאה ב${detail.name} לפי חודש`, `Spending at ${detail.name} by month`)}
            labels={shown.map((m) => monthName(m.month, true))}
            fullLabels={shown.map((m) => monthName(m.month))}
            series={[{ name: L("הוצאה", "Spending"), color: SERIES.expenses, values: shown.map((m) => m.minor) }]}
          />
        </section>
      )}

      {canEdit && (
        <section className="card stack">
          <h2>{L("ניהול בית העסק", "Manage merchant")}</h2>
          <form action={setMerchantCategoryAction} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="merchantId" value={id} />
            <div className="field-group" style={{ flex: "1 1 240px" }}>
              <label htmlFor="cat">{L("קטגוריה לכל העסקאות כאן (קודמות ועתידיות; עריכות ידניות נשמרות)", "Category for all purchases here (past and future; manual edits are kept)")}</label>
              <select className="field" id="cat" name="category" defaultValue={currentCat}>
                <option value="">{L("ללא (זיהוי אוטומטי)", "None (automatic)")}</option>
                {cats.filter((c) => c.type === "expense").map((c) => <option key={c.id} value={c.slug}>{categoryName(c.nameHe)}</option>)}
              </select>
            </div>
            <button className="btn primary" type="submit">{L("שמירה", "Save")}</button>
          </form>
          <form action={renameMerchantAction} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="merchantId" value={id} />
            <div className="field-group" style={{ flex: "1 1 240px" }}>
              <label htmlFor="name">{L("שם תצוגה", "Display name")}</label>
              <input className="field" id="name" name="name" defaultValue={detail.name} required />
            </div>
            <button className="btn" type="submit">{L("שינוי שם", "Rename")}</button>
          </form>
          <form action={mergeMerchantAction} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="merchantId" value={id} />
            <div className="field-group" style={{ flex: "1 1 240px" }}>
              <label htmlFor="target">{L("איחוד עם בית עסק אחר (אותו עסק בשם אחר)", "Merge with another merchant (the same business under another name)")}</label>
              <select className="field" id="target" name="targetId" defaultValue="">
                <option value="" disabled>{L("בחירה…", "Choose…")}</option>
                {others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button className="btn" type="submit">{L("איחוד", "Merge")}</button>
          </form>
          <p className="muted small" style={{ margin: 0 }}>{L("באיחוד, כל העסקאות עוברות לבית העסק שנבחר, וגם ייבואים עתידיים בשם הזה ישויכו אליו.", "When merging, all purchases move to the chosen merchant, and future imports under this name go to it too.")}</p>
        </section>
      )}
    </>
  );
}

