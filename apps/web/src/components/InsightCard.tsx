import Link from "next/link";
import type { InsightView } from "@/lib/insight-text";
import { L } from "@/lib/locale";

export interface InsightActions {
  action: (form: FormData) => Promise<void>;
  insightId: string;
  returnTo: string;
  /** set when the insight is already handled: offers to reopen it */
  handled?: "done" | "dismissed";
}

export function InsightCard({ view, actions }: { view: InsightView; actions?: InsightActions }) {
  const form = (status: string, label: string) =>
    actions && (
      <form action={actions.action}>
        <input type="hidden" name="insightId" value={actions.insightId} />
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="returnTo" value={actions.returnTo} />
        <button className="btn" type="submit" style={{ minBlockSize: 32, padding: "4px 10px", fontSize: 12 }}>{label}</button>
      </form>
    );
  return (
    <article className="card stack" style={{ "--gap": "8px", opacity: actions?.handled ? 0.75 : 1 } as React.CSSProperties}>
      <div className="row spread small">
        <span className="chip info">{view.confidence}</span>
        {view.impact && <span className="muted">{view.impact}</span>}
      </div>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>{view.title}</h3>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{view.what}</p>
      <p className="muted small" style={{ margin: 0, lineHeight: 1.5 }}>{view.why}</p>
      <div className="row spread" style={{ marginBlockStart: "auto" }}>
        <Link href={view.action.href} style={{ fontWeight: 500 }}>{view.action.label}</Link>
        {actions && (
          <span className="row" style={{ "--gap": "6px" } as React.CSSProperties}>
            {actions.handled ? form("open", actions.handled === "done" ? L("טופל · החזרה", "Handled · undo") : L("לא רלוונטי · החזרה", "Not relevant · undo")) : (
              <>
                {form("done", L("טופל", "Handled"))}
                {form("dismissed", L("לא רלוונטי", "Not relevant"))}
              </>
            )}
          </span>
        )}
      </div>
    </article>
  );
}
