import Link from "next/link";
import { conversationMessages, conversationsOf, LABELS, labelParagraphs, type ToolCallRecord, type Verification } from "@ft/assistant";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { env } from "@/lib/env";
import { askAction } from "./actions";
import { AskForm } from "./AskForm";

const EXAMPLES = [
  "כמה הוצאנו על מסעדות בחצי השנה האחרונה?",
  "אילו 5 בתי עסק קיבלו מאיתנו הכי הרבה כסף?",
  "האם ההוצאות שלנו עולות?",
  "איפה אפשר לחסוך ₪2,000 בחודש?",
  "האם נוכל להרשות לעצמנו חופשה ב-₪15,000?",
];
const KIND = { fact: { label: "עובדה", tone: "ok" }, estimate: { label: "הערכה", tone: "info" }, forecast: { label: "תחזית", tone: "info" }, recommendation: { label: "המלצה", tone: "warn" } } as const;
const TOOL_NAMES: Record<string, string> = {
  get_data_overview: "סקירת הנתונים",
  list_categories: "רשימת קטגוריות",
  get_monthly_totals: "סיכומים חודשיים",
  get_category_breakdown: "פירוט לפי קטגוריה",
  get_top_merchants: "בתי עסק מובילים",
  search_transactions: "חיפוש תנועות",
  get_recurring: "חיובים קבועים",
  get_budgets_and_goals: "תקציבים ויעדים",
  get_forecast: "תחזית",
  get_health_score: "ציון בריאות",
  get_insights: "תובנות",
};
const ERRORS: Record<string, string> = {
  rate_limited: "יותר מדי בקשות ל-Claude כרגע. נסו שוב בעוד דקה.",
  auth: "מפתח ה-API של Claude נדחה. בדקו את ANTHROPIC_API_KEY.",
  unavailable: "השירות של Claude לא זמין כרגע. נסו שוב בעוד רגע.",
  bad_request: "הבקשה ל-Claude נדחתה. נסו לנסח את השאלה אחרת.",
};

function describeCall(c: ToolCallRecord): string {
  const input = (c.input ?? {}) as Record<string, unknown>;
  const detail = [input.month, input.from_month && `${input.from_month}–${input.to_month}`, input.from_date && `${input.from_date}–${input.to_date}`, input.category_slug, input.text, input.member]
    .filter(Boolean)
    .join(" · ");
  return `${TOOL_NAMES[c.name] ?? c.name}${detail ? ` (${detail})` : ""}`;
}

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string; error?: string }> }) {
  const viewer = await requireViewer();
  const { c, error } = await searchParams;

  if (!env.aiEnabled) {
    return (
      <>
        <h1>שאלו את הכספים</h1>
        <div className="card stack">
          <p style={{ margin: 0 }}>העוזר כבוי. כדי להפעיל אותו, הוסיפו לקובץ ‎.env‎ את מפתח ה-API של Claude והפעילו מחדש:</p>
          <pre className="num" style={{ margin: 0, background: "#f3f4f6", padding: 12, borderRadius: 8 }}>{"ANTHROPIC_API_KEY=sk-ant-...\nAI_ENABLED=true"}</pre>
          <p className="muted small" style={{ margin: 0, lineHeight: 1.6 }}>
            כשהעוזר פעיל, השאלה ותוצאות השליפות שהוא מבצע (סכומים, תאריכים, שמות בתי עסק, קטגוריות, ושמות החשבונות וחברי משק הבית כפי שהגדרתם אותם) נשלחות ל-Anthropic לעיבוד. קבצי הדוחות, מספרי חשבון וכרטיס, והסיסמאות לא נשלחים. העוזר רק קורא נתונים ולא יכול לשנות אותם.
          </p>
        </div>
      </>
    );
  }

  const { conversations, messages } = await scope(householdScope(viewer), async (tx) => {
    const conversations = await conversationsOf(tx, viewer.memberId);
    const current = conversations.find((x) => x.id === c);
    return { conversations, messages: current ? await conversationMessages(tx, current.id) : [] };
  });
  const active = conversations.find((x) => x.id === c);

  return (
    <>
      <div className="row spread">
        <h1>שאלו את הכספים</h1>
        {active && <Link className="btn" href="/assistant">שיחה חדשה</Link>}
      </div>
      {error && <div role="alert" className="banner warn">{ERRORS[error] ?? "משהו השתבש. נסו שוב."}</div>}

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="stack" style={{ flex: "3 1 480px", minInlineSize: 0 }}>
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="card" style={{ background: "var(--accent-soft)", borderColor: "#b9dcd7", alignSelf: "flex-start", maxInlineSize: "85%" }}>
                {m.text}
              </div>
            ) : (
              <article key={m.id} className="card stack" style={{ "--gap": "12px" } as React.CSSProperties}>
                {labelParagraphs(m.text ?? "", LABELS).map((p, i) => (
                  <p key={i} style={{ margin: 0, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                    {p.kind && <span className={`chip ${KIND[p.kind as keyof typeof KIND].tone}`} style={{ marginInlineEnd: 8 }}>{KIND[p.kind as keyof typeof KIND].label}</span>}
                    {p.text}
                  </p>
                ))}
                {(m.verification as Verification | null)?.untraced?.length ? (
                  <div className="banner warn small">
                    המספרים {(m.verification as Verification).untraced.join(", ")} לא נמצאו בנתונים שנשלפו. ייתכן שהעוזר חישב אותם בעצמו או טעה. כדאי לבדוק אותם בדפי האפליקציה.
                  </div>
                ) : null}
                {(m.toolCalls as ToolCallRecord[] | null)?.length ? (
                  <details className="small">
                    <summary style={{ cursor: "pointer", color: "var(--accent)" }}>מבוסס על {(m.toolCalls as ToolCallRecord[]).filter((t) => t.ok).length} שליפות מהנתונים</summary>
                    <ul style={{ margin: "8px 0 0", paddingInlineStart: 18, lineHeight: 1.7 }}>
                      {(m.toolCalls as ToolCallRecord[]).map((t) => (
                        <li key={t.id} className={t.ok ? undefined : "muted"}>{describeCall(t)}{t.ok ? "" : " · נכשלה ותוקנה"}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ),
          )}
          <AskForm action={askAction} conversationId={active?.id} examples={active ? [] : EXAMPLES} />
          <p className="muted small" style={{ margin: 0, lineHeight: 1.6 }}>
            התשובות מבוססות רק על הנתונים שיובאו. השאלה ותוצאות השליפות נשלחות ל-Anthropic לעיבוד; קבצים, מספרי חשבון וסיסמאות לא נשלחים.
          </p>
        </div>
        {conversations.length > 0 && (
          <nav className="card stack" aria-label="שיחות קודמות" style={{ flex: "1 1 220px", "--gap": "6px" } as React.CSSProperties}>
            <h2 style={{ fontSize: 15 }}>שיחות קודמות</h2>
            {conversations.map((x) => (
              <Link key={x.id} href={`/assistant?c=${x.id}`} className="navlink" aria-current={x.id === active?.id ? "page" : undefined} style={{ minBlockSize: 36 }}>
                {x.title}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </>
  );
}
