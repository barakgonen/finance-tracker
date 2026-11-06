import Link from "next/link";
import type { InsightView } from "@/lib/insight-text";

export function InsightCard({ view }: { view: InsightView }) {
  return (
    <article className="card stack" style={{ "--gap": "8px" } as React.CSSProperties}>
      <div className="row spread small">
        <span className="chip info">{view.confidence}</span>
        {view.impact && <span className="muted">{view.impact}</span>}
      </div>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>{view.title}</h3>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{view.what}</p>
      <p className="muted small" style={{ margin: 0, lineHeight: 1.5 }}>{view.why}</p>
      <Link href={view.action.href} style={{ fontWeight: 500, marginBlockStart: "auto" }}>{view.action.label}</Link>
    </article>
  );
}
