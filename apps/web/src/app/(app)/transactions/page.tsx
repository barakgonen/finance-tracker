import Link from "next/link";
import { billsForDebits, billSummary, listTransactions, monthRange, UNCATEGORIZED } from "@ft/analytics";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { date, money, monthName } from "@/lib/format";
import { messages } from "@/lib/i18n";
import { periodHref, resolvePeriod } from "@/lib/period";
import { accounts, categories } from "@/lib/queries";

const PAGE = 100;
const SIDES = { spending: "הוצאות", income: "הכנסות", all: "כל התנועות" } as const;

type Params = { month?: string; view?: string; side?: string; category?: string; merchant?: string; account?: string; bill?: string; q?: string; page?: string };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer();
  const t = messages(viewer.locale);
  const params = await searchParams;
  const side = (Object.keys(SIDES) as (keyof typeof SIDES)[]).find((s) => s === params.side) ?? "all";
  const page = Math.max(1, Number(params.page) || 1);
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : undefined);

  const data = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    const cats = await categories(tx, viewer.householdId);
    const category = params.category === UNCATEGORIZED || cats.some((c) => c.slug === params.category) ? params.category : undefined;
    const { from, to } = monthRange(period.month);
    const bill = uuid(params.bill) ? await billSummary(tx, period.filters, params.bill!) : null;
    const result = await listTransactions(tx, period.filters, {
      from,
      to,
      side,
      category,
      merchantId: uuid(params.merchant),
      accountId: uuid(params.account),
      billId: bill?.billId,
      search: params.q?.trim().slice(0, 100) || undefined,
      limit: PAGE,
      offset: (page - 1) * PAGE,
    });
    const paid = await billsForDebits(tx, period.filters, result.rows.filter((r) => r.kind === "card_settlement").map((r) => r.id));
    return { period, cats, category, result, bill, paid, accts: await accounts(tx, viewer.householdId) };
  });
  const { period, cats, category, result, bill, paid, accts } = data;
  const pages = Math.max(1, Math.ceil(result.count / PAGE));
  const keep = { side, category, merchant: uuid(params.merchant), account: uuid(params.account), bill: bill?.billId, q: params.q };
  const total = side === "spending" ? -result.totalMinor : result.totalMinor;

  return (
    <>
      <h1>{bill ? "תנועות הדוח" : <>תנועות · {monthName(period.month)}</>}</h1>
      {bill && (
        <section className="banner ok" role="note">
          <span>
            {bill.cardName}
            {bill.cardLast4 ? <> •••• <span className="num">{bill.cardLast4}</span></> : null} · דוח לחיוב ב-<span className="num">{date(bill.postingDate)}</span> · סה״כ{" "}
            <strong className="num">{money(bill.totalMinor)}</strong>
            {" · "}
            {bill.debitId ? "נגבה מהבנק ונספר פעם אחת: כאן, לפי התנועות." : "עוד לא נמצא חיוב תואם בבנק."}{" "}
            <Link href={periodHref("/transactions", period, { side })}>חזרה לכל התנועות</Link>
          </span>
        </section>
      )}
      <form method="get" className="card row" style={{ alignItems: "flex-end" }}>
        <input type="hidden" name="month" value={period.month} />
        {period.view && <input type="hidden" name="view" value={period.view} />}
        {keep.merchant && <input type="hidden" name="merchant" value={keep.merchant} />}
        {keep.bill && <input type="hidden" name="bill" value={keep.bill} />}
        <div className="field-group" style={{ flex: "1 1 140px" }}>
          <label htmlFor="side">סוג</label>
          <select className="field" id="side" name="side" defaultValue={side}>
            {Object.entries(SIDES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field-group" style={{ flex: "1 1 180px" }}>
          <label htmlFor="category">קטגוריה</label>
          <select className="field" id="category" name="category" defaultValue={category ?? ""}>
            <option value="">הכל</option>
            <option value={UNCATEGORIZED}>ללא קטגוריה</option>
            {cats.map((c) => <option key={c.id} value={c.slug}>{c.nameHe}</option>)}
          </select>
        </div>
        <div className="field-group" style={{ flex: "1 1 160px" }}>
          <label htmlFor="account">חשבון</label>
          <select className="field" id="account" name="account" defaultValue={keep.account ?? ""}>
            <option value="">הכל</option>
            {accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field-group" style={{ flex: "2 1 200px" }}>
          <label htmlFor="q">חיפוש בתיאור</label>
          <input className="field" id="q" name="q" defaultValue={params.q ?? ""} />
        </div>
        <button className="btn primary" type="submit">סינון</button>
        {keep.merchant && <Link className="small" href={periodHref("/transactions", period, { side })}>ניקוי סינון בית עסק</Link>}
      </form>

      <section className="card row spread" aria-live="polite">
        <span>{result.count} תנועות</span>
        <span>
          סה״כ {side === "spending" ? "הוצאות" : side === "income" ? "הכנסות" : "תנועה נטו"}: <strong className="num">{money(total, { signed: side === "all" })}</strong>
        </span>
      </section>

      <section className="card" style={{ padding: "6px 4px" }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">תאריך</th><th scope="col">תיאור</th><th scope="col">קטגוריה</th><th scope="col">חשבון</th><th scope="col">סכום</th></tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{date(r.purchaseDate)}</td>
                  <td>
                    {r.description}
                    {r.installmentNo ? <span className="muted small"> · תשלום {r.installmentNo}/{r.installmentTotal}</span> : null}
                    {r.needsReview ? <span className="chip warn" style={{ marginInlineStart: 8 }}>לבדיקה</span> : null}
                    {paid.get(r.id)?.map((b) => (
                      <div key={b.billId} className="muted small">
                        {b.cardName === null ? (
                          <>משלם דוח של כרטיס פרטי · <span className="num">{money(b.totalMinor)}</span></>
                        ) : (
                          <>
                            משלם את הדוח של {b.cardName}
                            {b.cardLast4 ? <> •••• <span className="num">{b.cardLast4}</span></> : null} · <span className="num">{money(b.totalMinor)}</span> ·{" "}
                            <Link href={periodHref("/transactions", period, { bill: b.billId })}>{b.rowCount} תנועות</Link>
                          </>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="small">{r.categoryNameHe ?? t.kinds[r.kind]}</td>
                  <td className="small muted">{r.accountName}</td>
                  <td className="num" style={{ textAlign: "end" }}>
                    {money(r.amount, { signed: true })}
                    {r.originalAmount && r.originalCurrency ? <div className="muted small">{(Number(r.originalAmount) / 100).toFixed(2)} {r.originalCurrency}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {pages > 1 && (
        <nav className="row" aria-label="עמודים" style={{ justifyContent: "center" }}>
          {page > 1 && <Link className="btn" href={periodHref("/transactions", period, { ...keep, page: String(page - 1) })}>הקודם</Link>}
          <span className="muted small">עמוד {page} מתוך {pages}</span>
          {page < pages && <Link className="btn" href={periodHref("/transactions", period, { ...keep, page: String(page + 1) })}>הבא</Link>}
        </nav>
      )}
    </>
  );
}
