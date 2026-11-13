import Link from "next/link";
import { billsForDebits, billSummary, listTransactions, monthRange, shiftMonth, UNCATEGORIZED } from "@ft/analytics";
import { INCOME_KINDS, SPENDING_KINDS } from "@ft/core";
import { splitsOf } from "@ft/ingest";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { date, money, monthName } from "@/lib/format";
import { messages } from "@/lib/i18n";
import { periodHref, resolvePeriod } from "@/lib/period";
import { accounts, categories } from "@/lib/queries";
import { L, categoryName } from "@/lib/locale";

const PAGE = 100;
const SIDES = ["spending", "income", "all"] as const;
const sideName = (s: (typeof SIDES)[number]) => ({ spending: L("הוצאות", "Expenses"), income: L("הכנסות", "Income"), all: L("כל התנועות", "All transactions") })[s];

type Params = { month?: string; view?: string; side?: string; category?: string; merchant?: string; account?: string; bill?: string; q?: string; page?: string };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer();
  const t = messages(viewer.locale);
  const params = await searchParams;
  const side = SIDES.find((s) => s === params.side) ?? "all";
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
    const splits = await splitsOf(tx, viewer.householdId, result.rows.filter((r) => !r.isSplitPart).map((r) => r.id));
    return { period, cats, category, result, bill, paid, splits, accts: await accounts(tx, viewer.householdId) };
  });
  const { period, cats, category, result, bill, paid, splits, accts } = data;
  const canEdit = viewer.role !== "viewer";
  const pages = Math.max(1, Math.ceil(result.count / PAGE));
  const keep = { side, category, merchant: uuid(params.merchant), account: uuid(params.account), bill: bill?.billId, q: params.q };
  const total = side === "spending" ? -result.totalMinor : result.totalMinor;

  return (
    <>
      <h1>{bill ? L("תנועות הדוח", "Statement transactions") : <>{L("תנועות", "Transactions")} · {monthName(period.month)}</>}</h1>
      {bill && (
        <section className="banner ok" role="note">
          <span>
            {bill.cardName}
            {bill.cardLast4 ? <> <span className="num">•••• {bill.cardLast4}</span></> : null} · {L("דוח לחיוב ב-", "bill charged on ")}<span className="num">{date(bill.postingDate)}</span> · {L("סה״כ", "total")}{" "}
            <strong className="num">{money(bill.totalMinor)}</strong>
            {" · "}
            {bill.debitId ? L("נגבה מהבנק ונספר פעם אחת: כאן, לפי התנועות.", "Paid from the bank and counted once: here, by its transactions.") : L("עוד לא נמצא חיוב תואם בבנק.", "No matching bank charge found yet.")}{" "}
            <Link href={periodHref("/transactions", period, { side })}>{L("חזרה לכל התנועות", "Back to all transactions")}</Link>
          </span>
        </section>
      )}
      <form method="get" className="card row" style={{ alignItems: "flex-end" }}>
        <input type="hidden" name="month" value={period.month} />
        {period.view && <input type="hidden" name="view" value={period.view} />}
        {keep.merchant && <input type="hidden" name="merchant" value={keep.merchant} />}
        {keep.bill && <input type="hidden" name="bill" value={keep.bill} />}
        <div className="field-group" style={{ flex: "1 1 140px" }}>
          <label htmlFor="side">{L("סוג", "Type")}</label>
          <select className="field" id="side" name="side" defaultValue={side}>
            {SIDES.map((k) => <option key={k} value={k}>{sideName(k)}</option>)}
          </select>
        </div>
        <div className="field-group" style={{ flex: "1 1 180px" }}>
          <label htmlFor="category">{L("קטגוריה", "Category")}</label>
          <select className="field" id="category" name="category" defaultValue={category ?? ""}>
            <option value="">{L("הכל", "All")}</option>
            <option value={UNCATEGORIZED}>{L("ללא קטגוריה", "Uncategorized")}</option>
            {cats.map((c) => <option key={c.id} value={c.slug}>{categoryName(c.nameHe)}</option>)}
          </select>
        </div>
        <div className="field-group" style={{ flex: "1 1 160px" }}>
          <label htmlFor="account">{L("חשבון", "Account")}</label>
          <select className="field" id="account" name="account" defaultValue={keep.account ?? ""}>
            <option value="">{L("הכל", "All")}</option>
            {accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field-group" style={{ flex: "2 1 200px" }}>
          <label htmlFor="q">{L("חיפוש בתיאור", "Search description")}</label>
          <input className="field" id="q" name="q" defaultValue={params.q ?? ""} />
        </div>
        <button className="btn primary" type="submit">{L("סינון", "Filter")}</button>
        {keep.merchant && <Link className="small" href={periodHref("/transactions", period, { side })}>{L("ניקוי סינון בית עסק", "Clear merchant filter")}</Link>}
      </form>

      <section className="card row spread" aria-live="polite">
        <span>{result.count} {L("תנועות", "transactions")}</span>
        <span>
          {side === "spending" ? L("סה״כ הוצאות", "Total expenses") : side === "income" ? L("סה״כ הכנסות", "Total income") : L("סה״כ תנועה נטו", "Net total")}: <strong className="num">{money(total, { signed: side === "all" })}</strong>
        </span>
      </section>

      <section className="card" style={{ padding: "6px 4px" }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">{L("תאריך", "Date")}</th><th scope="col">{L("תיאור", "Description")}</th><th scope="col">{L("קטגוריה", "Category")}</th><th scope="col">{L("חשבון", "Account")}</th><th scope="col">{L("סכום", "Amount")}</th></tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{date(r.purchaseDate)}</td>
                  <td>
                    {r.description}
                    {r.installmentNo ? <span className="muted small"> · {L("תשלום", "installment")} {r.installmentNo}/{r.installmentTotal}</span> : null}
                    {r.needsReview ? <span className="chip warn" style={{ marginInlineStart: 8 }}>{L("לבדיקה", "To review")}</span> : null}
                    {paid.get(r.id)?.map((b) => (
                      <div key={b.billId} className="muted small">
                        {b.cardName === null ? (
                          <>{L("משלם דוח של כרטיס פרטי", "Pays a private card's bill")} · <span className="num">{money(b.totalMinor)}</span></>
                        ) : (
                          <>
                            {L("משלם את הדוח של", "Pays the bill of")} {b.cardName}
                            {b.cardLast4 ? <> <span className="num">•••• {b.cardLast4}</span></> : null} · <span className="num">{money(b.totalMinor)}</span> ·{" "}
                            <Link href={periodHref("/transactions", period, { bill: b.billId })}>{b.rowCount} {L("תנועות", "transactions")}</Link>
                          </>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="small">
                    {splits.has(r.id) ? (
                      <>
                        {L("מפוצל", "Split")}
                        {splits.get(r.id)!.map((p, i) => (
                          <div key={i} className="muted">
                            {p.categoryName ? categoryName(p.categoryName) : L("ללא קטגוריה", "Uncategorized")} · <span className="num">{money(p.amountMinor < 0n ? -p.amountMinor : p.amountMinor)}</span>
                            {new Set(splits.get(r.id)!.map((x) => x.memberId)).size > 1 ? (
                              <> · {p.memberId ? (period.people.find((m) => m.id === p.memberId)?.displayName ?? "") : L("משותף", "Shared")}</>
                            ) : null}
                          </div>
                        ))}
                      </>
                    ) : r.categoryNameHe ? (
                      categoryName(r.categoryNameHe)
                    ) : (
                      t.kinds[r.kind]
                    )}
                    {r.isSplitPart ? <div className="muted">{L("חלק מתנועה מפוצלת", "Part of a split transaction")}</div> : null}
                    {canEdit && (SPENDING_KINDS.has(r.kind) || INCOME_KINDS.has(r.kind)) ? (
                      <div>
                        <Link className="muted" href={`/transactions/${r.id}/split?back=${encodeURIComponent(periodHref("/transactions", period, { ...keep, page: String(page) }))}`}>
                          {splits.has(r.id) || r.isSplitPart ? L("עריכת הפיצול", "Edit split") : L("פיצול", "Split")}
                        </Link>
                      </div>
                    ) : null}
                  </td>
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
      {!bill && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>{L("ייצוא לאקסל או CSV", "Export to Excel or CSV")}</summary>
          <form method="get" action="/transactions/export" className="row" style={{ alignItems: "flex-end", marginBlockStart: 12 }}>
            {period.view && <input type="hidden" name="view" value={period.view} />}
            {Object.entries(keep).map(([k, v]) => (v && k !== "bill" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <div className="field-group" style={{ flex: "1 1 150px" }}>
              <label htmlFor="ex-from">{L("מחודש", "From")}</label>
              <select className="field" id="ex-from" name="from" defaultValue={period.month}>
                {Array.from({ length: 60 }, (_, i) => shiftMonth(period.month, -i)).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
              </select>
            </div>
            <div className="field-group" style={{ flex: "1 1 150px" }}>
              <label htmlFor="ex-to">{L("עד חודש", "To")}</label>
              <select className="field" id="ex-to" name="to" defaultValue={period.month}>
                {Array.from({ length: 60 }, (_, i) => shiftMonth(period.month, -i)).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
              </select>
            </div>
            <button className="btn primary" type="submit" name="format" value="xlsx">{L("הורדת אקסל", "Download Excel")}</button>
            <button className="btn" type="submit" name="format" value="csv">CSV</button>
            <p className="muted small" style={{ margin: 0, flexBasis: "100%" }}>
              {L(
                "הקובץ כולל את הסינון שבחרתם למעלה. תנועה מפוצלת מופיעה כשורה לכל חלק, כך שסכומים לפי קטגוריה באקסל יוצאים נכונים.",
                "The file uses the filters chosen above. A split transaction appears as one row per part, so sums by category in Excel come out right.",
              )}
            </p>
          </form>
        </details>
      )}
      {pages > 1 && (
        <nav className="row" aria-label={L("עמודים", "Pages")} style={{ justifyContent: "center" }}>
          {page > 1 && <Link className="btn" href={periodHref("/transactions", period, { ...keep, page: String(page - 1) })}>{L("הקודם", "Previous")}</Link>}
          <span className="muted small">{L("עמוד", "Page")} {page} {L("מתוך", "of")} {pages}</span>
          {page < pages && <Link className="btn" href={periodHref("/transactions", period, { ...keep, page: String(page + 1) })}>{L("הבא", "Next")}</Link>}
        </nav>
      )}
    </>
  );
}
