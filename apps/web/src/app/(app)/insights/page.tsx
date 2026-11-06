import { monthInsights } from "@ft/analytics";
import { InsightCard } from "@/components/InsightCard";
import { ScopeBar } from "@/components/ScopeBar";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { describeInsight } from "@/lib/insight-text";
import { resolvePeriod } from "@/lib/period";

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const { period, insights } = await scope(householdScope(viewer), async (tx) => {
    const period = await resolvePeriod(tx, viewer, params);
    return { period, insights: await monthInsights(tx, period.filters, period.month) };
  });
  return (
    <>
      <ScopeBar path="/insights" period={period} title="תובנות" />
      <p className="muted small" style={{ margin: 0 }}>
        כל תובנה מבוססת על התנועות שיובאו בלבד, ומסודרת לפי ההשפעה הכספית האפשרית. כשאין מספיק היסטוריה להשוואה, לא תוצג תובנה.
      </p>
      {insights.length === 0 ? (
        <div className="card">אין תובנות לחודש הזה.</div>
      ) : (
        <div className="grid">
          {insights.map((i) => <InsightCard key={i.id} view={describeInsight(i, period)} />)}
        </div>
      )}
    </>
  );
}
