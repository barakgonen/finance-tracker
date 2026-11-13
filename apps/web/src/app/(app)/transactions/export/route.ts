// Transactions as an Excel or CSV file, with the transactions page's filters over a range of
// months. Split transactions come out one row per part, so sums by category are right.
import { listTransactions, monthRange, monthsBetween, UNCATEGORIZED } from "@ft/analytics";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { messages } from "@/lib/i18n";
import { categoryName, isRtl, L } from "@/lib/locale";
import { resolvePeriod } from "@/lib/period";
import { categories, members } from "@/lib/queries";
import { toCsv, toXlsx, type Cell } from "@/lib/spreadsheet";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const PAGE = 2000;
const MAX_ROWS = 100_000;
const MAX_MONTHS = 60;

export async function GET(request: Request): Promise<Response> {
  const viewer = await requireViewer();
  const t = messages(viewer.locale);
  const p = new URL(request.url).searchParams;
  const get = (k: string) => p.get(k) ?? undefined;
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : undefined);
  const from = get("from") ?? "";
  const to = get("to") ?? "";
  if (!MONTH.test(from) || !MONTH.test(to) || from > to) return new Response(L("טווח חודשים לא תקין", "Invalid month range"), { status: 400 });
  if (monthsBetween(from, to).length > MAX_MONTHS) return new Response(L("עד 60 חודשים בכל ייצוא", "Up to 60 months per export"), { status: 400 });
  const side = (["spending", "income", "all"] as const).find((s) => s === get("side")) ?? "all";
  const format = get("format") === "csv" ? "csv" : "xlsx";

  const { rows, people } = await scope(householdScope(viewer), async (tx) => {
    // the same scope (household or one member) and privacy rules as the screens
    const period = await resolvePeriod(tx, viewer, { month: to, view: get("view") });
    const cats = await categories(tx, viewer.householdId);
    const category = get("category") === UNCATEGORIZED || cats.some((c) => c.slug === get("category")) ? get("category") : undefined;
    const query = {
      from: monthRange(from).from,
      to: monthRange(to).to,
      side,
      category,
      merchantId: uuid(get("merchant")),
      accountId: uuid(get("account")),
      search: get("q")?.trim().slice(0, 100) || undefined,
      lines: true,
      limit: PAGE,
    };
    const out: Awaited<ReturnType<typeof listTransactions>>["rows"] = [];
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      const page = await listTransactions(tx, period.filters, { ...query, offset });
      out.push(...page.rows);
      if (page.rows.length < PAGE) break;
    }
    return { rows: out, people: await members(tx, viewer.householdId) };
  });

  const nameOf = new Map(people.map((m) => [m.id, m.displayName]));
  const header = [
    L("תאריך", "Date"),
    L("תיאור", "Description"),
    L("סכום (₪)", "Amount (₪)"),
    L("קטגוריה", "Category"),
    L("סוג", "Type"),
    L("חשבון", "Account"),
    L("של מי", "Whose"),
    L("סכום מקורי", "Original amount"),
    L("מטבע מקורי", "Original currency"),
    L("הערות", "Notes"),
  ];
  const body: Cell[][] = rows.map((r) => [
    { date: r.purchaseDate },
    r.description,
    Number(r.amount) / 100,
    r.categoryNameHe ? categoryName(r.categoryNameHe) : "",
    t.kinds[r.kind],
    r.accountName,
    r.isShared || !r.memberId ? L("משותף", "Shared") : (nameOf.get(r.memberId) ?? ""),
    r.originalAmount !== null && r.originalCurrency ? Number(r.originalAmount) / 100 : null,
    r.originalAmount !== null && r.originalCurrency ? r.originalCurrency : "",
    [
      r.isSplitPart ? L("חלק מתנועה מפוצלת", "part of a split transaction") : "",
      r.installmentNo ? L(`תשלום ${r.installmentNo}/${r.installmentTotal}`, `installment ${r.installmentNo}/${r.installmentTotal}`) : "",
      r.needsReview ? L("ממתין לבדיקה", "waiting for review") : "",
    ]
      .filter(Boolean)
      .join("; "),
  ]);

  const name = `${L("תנועות", "transactions")}-${from}${from === to ? "" : `_${to}`}`;
  const bytes =
    format === "csv"
      ? toCsv(header, body)
      : toXlsx(header, body, { sheetName: L("תנועות", "Transactions"), rtl: isRtl(), widths: [12, 36, 14, 22, 18, 18, 12, 14, 10, 30] });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // RFC 5987 for the Hebrew name, plus an ASCII fallback
      "Content-Disposition": `attachment; filename="transactions-${from}.${format}"; filename*=UTF-8''${encodeURIComponent(name)}.${format}`,
      "Cache-Control": "no-store",
    },
  });
}
