import Link from "next/link";
import { conversationMessages, conversationsOf, LABELS, labelParagraphs, type ToolCallRecord, type Verification } from "@ft/assistant";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { env } from "@/lib/env";
import { askAction } from "./actions";
import { AskForm } from "./AskForm";
import { L } from "@/lib/locale";

const examples = () => [
  L("כמה הוצאנו על מסעדות בחצי השנה האחרונה?", "How much did we spend on restaurants in the last six months?"),
  L("אילו 5 בתי עסק קיבלו מאיתנו הכי הרבה כסף?", "Which 5 merchants got the most money from us?"),
  L("האם ההוצאות שלנו עולות?", "Is our spending going up?"),
  L("איפה אפשר לחסוך ₪2,000 בחודש?", "Where could we save ₪2,000 a month?"),
  L("האם נוכל להרשות לעצמנו חופשה ב-₪15,000?", "Can we afford a ₪15,000 vacation?"),
];
const askLabels = () => ({
  ask: L("שאלה", "Ask"),
  thinking: L("חושב… (עד דקה)", "Thinking… (up to a minute)"),
  question: L("מה תרצו לדעת?", "What would you like to know?"),
  followUp: L("שאלת המשך", "Follow-up question"),
  placeholder: L("למשל: כמה הוצאנו על מסעדות בחצי השנה האחרונה?", "For example: how much did we spend on restaurants in the last six months?"),
});
const KIND = {
  fact: { get label() { return L("עובדה", "Fact"); }, tone: "ok" },
  estimate: { get label() { return L("הערכה", "Estimate"); }, tone: "info" },
  forecast: { get label() { return L("תחזית", "Forecast"); }, tone: "info" },
  recommendation: { get label() { return L("המלצה", "Recommendation"); }, tone: "warn" },
} as const;
const TOOL_NAMES: Record<string, string> = {
  get get_data_overview() {
    return L("סקירת הנתונים", "Data overview");
  },
  get list_categories() {
    return L("רשימת קטגוריות", "Category list");
  },
  get get_monthly_totals() {
    return L("סיכומים חודשיים", "Monthly totals");
  },
  get get_category_breakdown() {
    return L("פירוט לפי קטגוריה", "Breakdown by category");
  },
  get get_top_merchants() {
    return L("בתי עסק מובילים", "Top merchants");
  },
  get search_transactions() {
    return L("חיפוש תנועות", "Transaction search");
  },
  get get_recurring() {
    return L("חיובים קבועים", "Recurring charges");
  },
  get get_budgets_and_goals() {
    return L("תקציבים ויעדים", "Budgets and goals");
  },
  get get_forecast() {
    return L("תחזית", "Forecast");
  },
  get get_health_score() {
    return L("ציון בריאות", "Health score");
  },
  get get_insights() {
    return L("תובנות", "Insights");
  },
};
const ERRORS: Record<string, string> = {
  get rate_limited() {
    return L("יותר מדי בקשות ל-Claude כרגע. נסו שוב בעוד דקה.", "Too many requests to Claude right now. Try again in a minute.");
  },
  get auth() {
    return L("מפתח ה-API של Claude נדחה. בדקו את ANTHROPIC_API_KEY.", "The Claude API key was rejected. Check ANTHROPIC_API_KEY.");
  },
  get unavailable() {
    return L("השירות של Claude לא זמין כרגע. נסו שוב בעוד רגע.", "Claude is unavailable right now. Try again shortly.");
  },
  get bad_request() {
    return L("הבקשה ל-Claude נדחתה. נסו לנסח את השאלה אחרת.", "The request to Claude was rejected. Try phrasing the question differently.");
  },
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
        <h1>{L("שאלו את הכספים", "Ask your finances")}</h1>
        <div className="card stack">
          <p style={{ margin: 0 }}>{L("העוזר כבוי. כדי להפעיל אותו, הוסיפו לקובץ ‎.env‎ את מפתח ה-API של Claude והפעילו מחדש:", "The assistant is off. To turn it on, add your Claude API key to the .env file and restart:")}</p>
          <pre className="num" style={{ margin: 0, background: "var(--code-bg)", padding: 12, borderRadius: 8 }}>{"ANTHROPIC_API_KEY=sk-ant-...\nAI_ENABLED=true"}</pre>
          <p className="muted small" style={{ margin: 0, lineHeight: 1.6 }}>
            {L(
              "כשהעוזר פעיל, השאלה ותוצאות השליפות שהוא מבצע (סכומים, תאריכים, שמות בתי עסק, קטגוריות, ושמות החשבונות וחברי משק הבית כפי שהגדרתם אותם) נשלחות ל-Anthropic לעיבוד. קבצי הדוחות, מספרי חשבון וכרטיס, והסיסמאות לא נשלחים. העוזר רק קורא נתונים ולא יכול לשנות אותם.",
              "When the assistant is on, the question and the results of the lookups it makes (amounts, dates, merchant names, categories, and account and member names as you set them) are sent to Anthropic for processing. Statement files, account and card numbers, and passwords are not sent. The assistant only reads data and can't change it.",
            )}
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
        <h1>{L("שאלו את הכספים", "Ask your finances")}</h1>
        {active && <Link className="btn" href="/assistant">{L("שיחה חדשה", "New conversation")}</Link>}
      </div>
      {error && <div role="alert" className="banner warn">{ERRORS[error] ?? L("משהו השתבש. נסו שוב.", "Something went wrong. Try again.")}</div>}

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="stack" style={{ flex: "3 1 480px", minInlineSize: 0 }}>
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="card" style={{ background: "var(--accent-soft)", borderColor: "var(--ok-border)", alignSelf: "flex-start", maxInlineSize: "85%" }}>
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
                    {L(
                      `המספרים ${(m.verification as Verification).untraced.join(", ")} לא נמצאו בנתונים שנשלפו. ייתכן שהעוזר חישב אותם בעצמו או טעה. כדאי לבדוק אותם בדפי האפליקציה.`,
                      `The numbers ${(m.verification as Verification).untraced.join(", ")} weren't found in the retrieved data. The assistant may have calculated them itself or made a mistake. It's worth checking them in the app's pages.`,
                    )}
                  </div>
                ) : null}
                {(m.toolCalls as ToolCallRecord[] | null)?.length ? (
                  <details className="small">
                    <summary style={{ cursor: "pointer", color: "var(--accent)" }}>{L("מבוסס על", "Based on")} {(m.toolCalls as ToolCallRecord[]).filter((t) => t.ok).length} {L("שליפות מהנתונים", "data lookups")}</summary>
                    <ul style={{ margin: "8px 0 0", paddingInlineStart: 18, lineHeight: 1.7 }}>
                      {(m.toolCalls as ToolCallRecord[]).map((t) => (
                        <li key={t.id} className={t.ok ? undefined : "muted"}>{describeCall(t)}{t.ok ? "" : L(" · נכשלה ותוקנה", " · failed and retried")}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ),
          )}
          <AskForm action={askAction} conversationId={active?.id} examples={active ? [] : examples()} labels={askLabels()} />
          <p className="muted small" style={{ margin: 0, lineHeight: 1.6 }}>
            {L(
              "התשובות מבוססות רק על הנתונים שיובאו. השאלה ותוצאות השליפות נשלחות ל-Anthropic לעיבוד; קבצים, מספרי חשבון וסיסמאות לא נשלחים.",
              "Answers are based only on imported data. The question and the lookup results are sent to Anthropic for processing; files, account numbers and passwords are not sent.",
            )}
          </p>
        </div>
        {conversations.length > 0 && (
          <nav className="card stack" aria-label={L("שיחות קודמות", "Earlier conversations")} style={{ flex: "1 1 220px", "--gap": "6px" } as React.CSSProperties}>
            <h2 style={{ fontSize: 15 }}>{L("שיחות קודמות", "Earlier conversations")}</h2>
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
