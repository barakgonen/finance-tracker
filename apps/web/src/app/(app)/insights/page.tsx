import { openInsights } from "@ft/analytics";
import { InsightCard } from "@/components/InsightCard";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { describeInsight } from "@/lib/insight-text";
import { periodHref, resolvePeriod } from "@/lib/period";
import { insightStateAction } from "./actions";
import { L } from "@/lib/locale";

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const { period, open, handled } = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    return { period, ...(await openInsights(tx, period.filters, period.month)) };
  });
  const canEdit = viewer.role !== "viewer";
  const here = periodHref("/insights", period);
  const actions = (id: string, status?: "done" | "dismissed") => (canEdit ? { action: insightStateAction, insightId: id, returnTo: here, handled: status } : undefined);
  return (
    <>
      <ScopeBar path="/insights" period={period} title={L("תובנות", "Insights")} />
      <p className="muted small" style={{ margin: 0 }}>
        {L("כל תובנה מבוססת על התנועות שיובאו בלבד, ומסודרת לפי ההשפעה הכספית האפשרית. כשאין מספיק היסטוריה להשוואה, לא תוצג תובנה.", "Every insight is based only on imported transactions and is ordered by its possible financial impact. Without enough history to compare, no insight is shown.")}
      </p>
      {open.length === 0 ? (
        <div className="card">{handled.length ? L("כל התובנות של החודש טופלו.", "All of this month's insights were handled.") : L("אין תובנות לחודש הזה.", "No insights for this month.")}</div>
      ) : (
        <div className="grid">
          {open.map((i) => <InsightCard key={i.id} view={describeInsight(i, period)} actions={actions(i.id)} />)}
        </div>
      )}
      {handled.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer" }}>{L("תובנות שטופלו או סומנו כלא רלוונטיות", "Insights handled or marked not relevant")} ({handled.length})</summary>
          <div className="grid" style={{ marginBlockStart: 12 }}>
            {handled.map(({ insight, status }) => <InsightCard key={insight.id} view={describeInsight(insight, period)} actions={actions(insight.id, status)} />)}
          </div>
        </details>
      )}
    </>
  );
}
