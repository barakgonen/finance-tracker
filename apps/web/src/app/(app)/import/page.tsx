import Link from "next/link";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { messages } from "@/lib/i18n";
import { accounts, imports } from "@/lib/queries";
import { outdatedImports } from "@ft/ingest";
import { currentParserVersion } from "@ft/parsers";
import { uploadAction } from "./actions";
import { L } from "@/lib/locale";

const ERRORS: Record<string, string> = {
  get duplicate() {
    return L("הקובץ הזה כבר יובא.", "This file was already imported.");
  },
  get bad_file() {
    return L("יש לבחור קובץ PDF, XLSX או XLS.", "Choose a PDF, XLSX or XLS file.");
  },
  get too_large() {
    return L("הקובץ גדול מ-20MB.", "The file is larger than 20MB.");
  },
};
const STATUS: Record<string, { label: string; tone: string }> = {
  parsed: { get label() { return L("ממתין לאישור", "Waiting for approval"); }, tone: "info" },
  committed: { get label() { return L("יובא", "Imported"); }, tone: "ok" },
  failed: { get label() { return L("נכשל", "Failed"); }, tone: "warn" },
  discarded: { get label() { return L("בוטל", "Cancelled"); }, tone: "" },
  uploaded: { get label() { return L("הועלה", "Uploaded"); }, tone: "" },
};

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string; existing?: string }> }) {
  const viewer = await requireViewer();
  const t = messages(viewer.locale);
  const { error, existing } = await searchParams;
  const [accts, history, outdated] = await scope(householdScope(viewer), async (tx) => [
    await accounts(tx, viewer.householdId),
    await imports(tx, viewer.householdId),
    new Set((await outdatedImports(tx, viewer.householdId, currentParserVersion)).map((x) => x.id)),
  ] as const);

  return (
    <>
      <h1>{t.import.title}</h1>
      {error && (
        <div role="alert" className="banner warn">
          {ERRORS[error] ?? t.errors.generic} {existing && <Link href={`/import/${existing}`}>{L("לייבוא הקודם", "To the earlier import")}</Link>}
        </div>
      )}
      {viewer.role !== "viewer" && (
        <form action={uploadAction} className="card stack">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field-group" style={{ flex: "2 1 280px" }}>
              <label htmlFor="file">{t.import.file}</label>
              <input className="field" id="file" name="file" type="file" accept=".pdf,.xlsx,.xls,.csv" required style={{ paddingBlock: "10px" }} />
            </div>
            <div className="field-group" style={{ flex: "1 1 220px" }}>
              <label htmlFor="accountId">{t.import.account}</label>
              <select className="field" id="accountId" name="accountId" defaultValue="">
                <option value="">{t.import.autoAccount}</option>
                {accts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <button className="btn primary" type="submit">{t.import.upload}</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {L("הקובץ נשמר מוצפן. לפני שמשהו נשמר תוצג תצוגה מקדימה עם בדיקת התאמה לסכומים שבדוח.", "The file is stored encrypted. Before anything is saved, you'll see a preview checked against the statement's printed totals.")}
          </p>
        </form>
      )}

      <section className="card stack">
        <h2>{t.import.history}</h2>
        {history.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{L("עוד לא יובאו דוחות.", "No statements imported yet.")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">{L("קובץ", "File")}</th><th scope="col">{t.import.account}</th><th scope="col">{L("סטטוס", "Status")}</th><th scope="col">{L("נוספו", "Added")}</th><th scope="col">{L("תאריך", "Date")}</th></tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const s = STATUS[h.status] ?? { label: h.status, tone: "" };
                  const inserted = (h.stats as { inserted?: number } | null)?.inserted;
                  return (
                    <tr key={h.id}>
                      <td><Link href={`/import/${h.id}`}><span className="num">{h.fileName}</span></Link></td>
                      <td>{h.accountName ?? "—"}</td>
                      <td>
                        <span className={`chip ${s.tone}`}>{s.label}</span>
                        {outdated.has(h.id) && <Link href={`/import/${h.id}/reprocess`} className="chip info" style={{ marginInlineStart: 6, textDecoration: "none" }}>{L("מפענח מעודכן זמין", "Updated parser available")}</Link>}
                      </td>
                      <td className="num">{inserted ?? "—"}</td>
                      <td className="num">{h.createdAt.toLocaleDateString("he-IL")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
