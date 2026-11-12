import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { hebrewError } from "@/lib/errors";
import { categoryName, L } from "@/lib/locale";
import { categories } from "@/lib/queries";
import { createCategoryAction, deleteCategoryAction, renameCategoryAction } from "./actions";

type Category = Awaited<ReturnType<typeof categories>>[number];

function Custom({ c, others, readOnly }: { c: Category; others: Category[]; readOnly: boolean }) {
  if (readOnly) return <li className="row spread"><span>{c.nameHe}</span></li>;
  return (
    <li>
      <details className="stack" style={{ "--gap": "10px", borderBlockEnd: "1px solid var(--row-line)", paddingBlock: 10 } as React.CSSProperties}>
        <summary style={{ cursor: "pointer" }}>
          {c.nameHe}
          {c.nameEn !== c.nameHe ? <span className="muted small"> · {c.nameEn}</span> : null}
        </summary>
        <form action={renameCategoryAction} className="row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="id" value={c.id} />
          <div className="field-group" style={{ flex: "1 1 160px" }}>
            <label htmlFor={`n-${c.id}`}>{L("שם", "Name")}</label>
            <input className="field" id={`n-${c.id}`} name="name" defaultValue={c.nameHe} required maxLength={40} />
          </div>
          <div className="field-group" style={{ flex: "1 1 160px" }}>
            <label htmlFor={`e-${c.id}`}>{L("שם באנגלית (לא חובה)", "English name (optional)")}</label>
            <input className="field" id={`e-${c.id}`} name="nameEn" defaultValue={c.nameEn === c.nameHe ? "" : c.nameEn} maxLength={40} dir="ltr" />
          </div>
          <button className="btn" type="submit">{L("שינוי שם", "Rename")}</button>
        </form>
        <form action={deleteCategoryAction} className="row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="id" value={c.id} />
          <div className="field-group" style={{ flex: "2 1 220px" }}>
            <label htmlFor={`m-${c.id}`}>{L("מחיקה: להעביר את התנועות, הכללים והתקציב אל", "Delete: move its transactions, rules and budget to")}</label>
            <select className="field" id={`m-${c.id}`} name="moveTo" defaultValue="">
              <option value="">{L("ללא קטגוריה (תקציבים יימחקו, יעדים יועברו לארכיון)", "Uncategorized (budgets removed, goals archived)")}</option>
              {others.map((o) => <option key={o.id} value={o.slug}>{categoryName(o.nameHe)}</option>)}
            </select>
          </div>
          <button className="btn" type="submit">{L("מחיקה", "Delete")}</button>
        </form>
      </details>
    </li>
  );
}

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const cats = await scope(householdScope(viewer), (tx) => categories(tx, viewer.householdId));
  const readOnly = viewer.role === "viewer";
  const section = (type: "expense" | "income", title: string) => {
    const own = cats.filter((c) => c.type === type);
    const custom = own.filter((c) => !c.isSystem);
    return (
      <section className="card stack" aria-labelledby={`h-${type}`}>
        <h2 id={`h-${type}`}>{title}</h2>
        {custom.length > 0 ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {custom.map((c) => <Custom key={c.id} c={c} others={own.filter((o) => o.id !== c.id)} readOnly={readOnly} />)}
          </ul>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>{L("עוד לא נוספו קטגוריות משלכם.", "No categories of your own yet.")}</p>
        )}
        <details>
          <summary className="small" style={{ cursor: "pointer" }}>{L(`קטגוריות מובנות (${own.length - custom.length})`, `Built-in categories (${own.length - custom.length})`)}</summary>
          <p className="small muted" style={{ lineHeight: 1.8 }}>{own.filter((c) => c.isSystem).map((c) => categoryName(c.nameHe)).join(" · ")}</p>
        </details>
      </section>
    );
  };

  return (
    <>
      <header className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
        <h1>{L("קטגוריות", "Categories")}</h1>
        <p className="muted small" style={{ margin: 0 }}>
          {L(
            "אפשר להוסיף קטגוריות משלכם לצד הקטגוריות המובנות, ולהשתמש בהן בסיווג, בכללים, בתקציבים ובפיצול תנועות.",
            "Add categories of your own next to the built-in ones, and use them in corrections, rules, budgets and split transactions.",
          )}
        </p>
      </header>
      {params.error && <div role="alert" className="banner warn">{hebrewError(params.error)}</div>}
      {params.saved && <div role="status" className="banner ok">{L("נשמר", "Saved")}</div>}

      {!readOnly && (
        <form action={createCategoryAction} className="card row" style={{ alignItems: "flex-end" }}>
          <div className="field-group" style={{ flex: "1 1 130px" }}>
            <label htmlFor="type">{L("סוג", "Type")}</label>
            <select className="field" id="type" name="type" defaultValue="expense">
              <option value="expense">{L("הוצאה", "Expense")}</option>
              <option value="income">{L("הכנסה", "Income")}</option>
            </select>
          </div>
          <div className="field-group" style={{ flex: "2 1 180px" }}>
            <label htmlFor="name">{L("שם", "Name")}</label>
            <input className="field" id="name" name="name" required maxLength={40} placeholder={L("למשל: גינה", "e.g. Garden")} />
          </div>
          <div className="field-group" style={{ flex: "2 1 180px" }}>
            <label htmlFor="nameEn">{L("שם באנגלית (לא חובה)", "English name (optional)")}</label>
            <input className="field" id="nameEn" name="nameEn" maxLength={40} dir="ltr" />
          </div>
          <button className="btn primary" type="submit">{L("הוספה", "Add")}</button>
        </form>
      )}

      {section("expense", L("קטגוריות הוצאה", "Spending categories"))}
      {section("income", L("קטגוריות הכנסה", "Income categories"))}
    </>
  );
}
