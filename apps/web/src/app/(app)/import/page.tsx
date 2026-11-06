import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { messages } from "@/lib/i18n";
import { accounts, imports } from "@/lib/queries";
import { uploadAction } from "./actions";

const ERRORS: Record<string, string> = {
  duplicate: "הקובץ הזה כבר יובא.",
  bad_file: "יש לבחור קובץ PDF, XLSX או XLS.",
  too_large: "הקובץ גדול מ-20MB.",
};
const STATUS: Record<string, { label: string; tone: string }> = {
  parsed: { label: "ממתין לאישור", tone: "info" },
  committed: { label: "יובא", tone: "ok" },
  failed: { label: "נכשל", tone: "warn" },
  discarded: { label: "בוטל", tone: "" },
  uploaded: { label: "הועלה", tone: "" },
};

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string; existing?: string }> }) {
  const viewer = await requireViewer();
  const t = messages(viewer.locale);
  const { error, existing } = await searchParams;
  const [accts, history] = await Promise.all([accounts(viewer.householdId), imports(viewer.householdId)]);

  return (
    <>
      <h1>{t.import.title}</h1>
      {error && (
        <div role="alert" className="banner warn">
          {ERRORS[error] ?? t.errors.generic} {existing && <Link href={`/import/${existing}`}>לייבוא הקודם</Link>}
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
            הקובץ נשמר מוצפן. לפני שמשהו נשמר תוצג תצוגה מקדימה עם בדיקת התאמה לסכומים שבדוח.
          </p>
        </form>
      )}

      <section className="card stack">
        <h2>{t.import.history}</h2>
        {history.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>עוד לא יובאו דוחות.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">קובץ</th><th scope="col">{t.import.account}</th><th scope="col">סטטוס</th><th scope="col">נוספו</th><th scope="col">תאריך</th></tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const s = STATUS[h.status] ?? { label: h.status, tone: "" };
                  const inserted = (h.stats as { inserted?: number } | null)?.inserted;
                  return (
                    <tr key={h.id}>
                      <td><Link href={`/import/${h.id}`}><span className="num">{h.fileName}</span></Link></td>
                      <td>{h.accountName ?? "—"}</td>
                      <td><span className={`chip ${s.tone}`}>{s.label}</span></td>
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
