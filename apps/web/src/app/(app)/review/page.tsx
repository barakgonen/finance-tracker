import { TRANSACTION_KINDS } from "@ft/core";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { date, money } from "@/lib/format";
import { messages } from "@/lib/i18n";
import { categories, members, reviewItems } from "@/lib/queries";
import { correctAction } from "./actions";

export default async function ReviewPage() {
  const viewer = await requireViewer();
  const t = messages(viewer.locale);
  const [items, cats, people] = await scope(householdScope(viewer), async (tx) => [
    await reviewItems(tx, viewer.householdId),
    await categories(tx, viewer.householdId),
    await members(tx, viewer.householdId),
  ] as const);
  const expenseCats = cats.filter((c) => c.type === "expense");
  const incomeCats = cats.filter((c) => c.type === "income");
  const readOnly = viewer.role === "viewer";

  return (
    <>
      <header className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
        <h1>{t.review.title}</h1>
        <p className="muted small" style={{ margin: 0 }}>{t.review.hint}</p>
      </header>
      {items.length === 0 && <div className="card">{t.review.empty}</div>}
      {items.map(({ tx, accountName, categorySlug }) => (
        <article key={tx.id} className="card stack" aria-labelledby={`t-${tx.id}`}>
          <div className="row spread" style={{ alignItems: "flex-start" }}>
            <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
              {tx.reviewReason && <span className="chip warn" style={{ alignSelf: "flex-start" }}>{tx.reviewReason}</span>}
              <h2 id={`t-${tx.id}`}>{tx.descriptionRaw}</h2>
              <span className="muted small">
                {accountName} · <span className="num">{date(tx.purchaseDate)}</span>
                {tx.categoryHint ? ` · ענף: ${tx.categoryHint}` : ""}
                {tx.classificationReason ? ` · ${tx.classificationReason}` : ""}
              </span>
            </div>
            <span className="kpi num" style={{ fontSize: 22, color: tx.amount > 0n ? "var(--income)" : undefined }}>{money(tx.amount, { signed: true })}</span>
          </div>
          {!readOnly && (
            <form action={correctAction} className="row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="transactionId" value={tx.id} />
              <div className="field-group" style={{ flex: "1 1 180px" }}>
                <label htmlFor={`k-${tx.id}`}>{t.review.kind}</label>
                <select className="field" id={`k-${tx.id}`} name="kind" defaultValue={tx.kind}>
                  {TRANSACTION_KINDS.map((k) => (
                    <option key={k} value={k}>{t.kinds[k]}</option>
                  ))}
                </select>
              </div>
              <div className="field-group" style={{ flex: "1 1 200px" }}>
                <label htmlFor={`c-${tx.id}`}>{t.review.category}</label>
                <select className="field" id={`c-${tx.id}`} name="category" defaultValue={categorySlug ?? ""}>
                  <option value="">{t.review.none}</option>
                  <optgroup label={t.dashboard.expenses}>
                    {expenseCats.map((c) => <option key={c.id} value={c.slug}>{c.nameHe}</option>)}
                  </optgroup>
                  <optgroup label={t.dashboard.income}>
                    {incomeCats.map((c) => <option key={c.id} value={c.slug}>{c.nameHe}</option>)}
                  </optgroup>
                </select>
              </div>
              <div className="field-group" style={{ flex: "1 1 150px" }}>
                <label htmlFor={`o-${tx.id}`}>{t.review.member}</label>
                <select className="field" id={`o-${tx.id}`} name="owner" defaultValue={tx.isShared ? "shared" : (tx.memberId ?? "shared")}>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                  <option value="shared">{t.review.shared}</option>
                </select>
              </div>
              <label className="check" style={{ flex: "1 1 240px" }}>
                <input type="checkbox" name="applyToMerchant" defaultChecked={tx.merchantId !== null} /> {t.review.applyAll}
              </label>
              <button className="btn primary" type="submit">{t.review.save}</button>
            </form>
          )}
        </article>
      ))}
    </>
  );
}
